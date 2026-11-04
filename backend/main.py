from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import yfinance as yf
import pandas as pd
import requests

app = FastAPI(title="Taiwan Stock Advanced Signal API")

# 開放所有網域連線 (允許 Vercel 與手機 App 請求)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def calculate_atr(df: pd.DataFrame, period=14):
    high_low = df["high"] - df["low"]
    high_close = (df["high"] - df["close"].shift(1)).abs()
    low_close = (df["low"] - df["close"].shift(1)).abs()
    tr = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    return tr.rolling(window=period).mean()

def get_market_regime():
    try:
        m_ticker = yf.Ticker("^TWII")
        m_hist = m_ticker.history(period="3mo")
        if not m_hist.empty:
            m_hist["ma20"] = m_hist["Close"].rolling(20).mean()
            latest = m_hist.iloc[-1]
            m_close = round(float(latest["Close"]), 2)
            m_ma20 = round(float(latest["ma20"]), 2)
            is_bull = m_close >= m_ma20
            return {
                "name": "加權指數 (^TWII)",
                "close": m_close,
                "ma20": m_ma20,
                "is_bull": is_bull,
                "status": "大盤處於月線上方（多頭格局，做多環境佳）" if is_bull else "大盤跌破月線（偏空防守，做多勝率偏低）"
            }
    except Exception:
        pass
    return {
        "name": "加權指數 (^TWII)",
        "close": 0.0,
        "ma20": 0.0,
        "is_bull": True,
        "status": "大盤數據正常"
    }

def get_institutional_data(symbol: str):
    try:
        url = "https://openapi.twse.com.tw/v1/fund/T86"
        res = requests.get(url, timeout=2.0)
        if res.status_code == 200:
            data = res.json()
            for row in data:
                if row.get("Code") == symbol:
                    foreign = int(row.get("ForeignInvestorsNetBuySell", "0").replace(",", "")) // 1000
                    trust = int(row.get("InvestmentTrustNetBuySell", "0").replace(",", "")) // 1000
                    dealer = int(row.get("DealerNetBuySell", "0").replace(",", "")) // 1000
                    return {
                        "available": True,
                        "foreign": foreign,
                        "trust": trust,
                        "dealer": dealer,
                        "total": foreign + trust + dealer
                    }
    except Exception:
        pass
    return {"available": False, "foreign": 0, "trust": 0, "dealer": 0, "total": 0}

def evaluate_signals(df: pd.DataFrame):
    df["ma5"] = df["close"].rolling(window=5).mean()
    df["ma20"] = df["close"].rolling(window=20).mean()
    df["vol_ma20"] = df["volume"].rolling(window=20).mean()
    df["atr"] = calculate_atr(df, 14)

    buy_cond = (
        (df["close"] > df["ma20"]) &
        (df["close"].shift(1) <= df["ma20"].shift(1)) &
        (df["volume"] > df["vol_ma20"] * 1.2)
    )
    sell_cond = (
        (df["close"] < df["ma20"]) &
        (df["close"].shift(1) >= df["ma20"].shift(1))
    )

    df["signal"] = "HOLD"
    df.loc[buy_cond, "signal"] = "BUY"
    df.loc[sell_cond, "signal"] = "SELL"
    return df

@app.get("/api/v1/stocks/{symbol}/kline")
def get_stock_kline(symbol: str):
    clean_symbol = symbol.strip().upper()

    hist = pd.DataFrame()
    for suffix in [".TW", ".TWO"]:
        ticker_symbol = f"{clean_symbol}{suffix}"
        ticker = yf.Ticker(ticker_symbol)
        try:
            temp_hist = ticker.history(period="6mo")
            if not temp_hist.empty:
                hist = temp_hist
                break
        except Exception:
            continue

    if hist.empty:
        raise HTTPException(status_code=404, detail="找不到此股票代碼或查無資料")

    hist = hist.reset_index()
    hist.rename(columns={
        "Date": "date", "Open": "open", "High": "high",
        "Low": "low", "Close": "close", "Volume": "volume"
    }, inplace=True)
    hist["date"] = hist["date"].dt.strftime("%Y-%m-%d")

    processed_df = evaluate_signals(hist)
    processed_df = processed_df.fillna(0)

    latest = processed_df.iloc[-1]
    current_price = round(float(latest["close"]), 2)
    ma5 = round(float(latest["ma5"]), 2)
    ma20 = round(float(latest["ma20"]), 2)
    vol = float(latest["volume"])
    vol_ma20 = float(latest["vol_ma20"]) if float(latest["vol_ma20"]) > 0 else 1.0
    vol_ratio = round(vol / vol_ma20, 2)
    
    latest_atr = round(float(latest["atr"]), 2)
    if latest_atr <= 0:
        latest_atr = round(current_price * 0.02, 2)

    bias = round(((current_price - ma20) / ma20) * 100, 2) if ma20 > 0 else 0.0

    market = get_market_regime()
    inst = get_institutional_data(clean_symbol)

    score = 50
    reasons = []

    if current_price >= ma20:
        score += 20
        reasons.append("技術面：站上 20 日月線")
    else:
        score -= 25
        reasons.append("技術面：跌破月線偏空")

    if ma5 >= ma20:
        score += 15
        reasons.append("技術面：5MA > 20MA 多頭排列")
    else:
        score -= 10

    if vol_ratio >= 1.2:
        score += 15
        reasons.append(f"動能面：量能放大 ({vol_ratio} 倍)")
    elif vol_ratio < 0.7:
        score -= 10
        reasons.append("動能面：成交量低迷")

    if inst["available"]:
        if inst["foreign"] > 200 or inst["trust"] > 100:
            score += 15
            reasons.append(f"籌碼面：法人買超 (外資 {inst['foreign']:+,} 張, 投信 {inst['trust']:+,} 張)")
        elif inst["foreign"] < -500 or inst["trust"] < -200:
            score -= 15
            reasons.append(f"籌碼面：法人大幅調節 (外資 {inst['foreign']:+,} 張, 投信 {inst['trust']:+,} 張)")

    if not market["is_bull"]:
        score = int(score * 0.7)
        reasons.append("⚠️ 大盤濾網：加權指數跌破月線，全體多單勝率受壓制 (評分打 7 折)")
    else:
        reasons.append("🟢 大盤濾網：加權指數站上月線，大盤環境有利多方")

    bias_limit = 2.5 if current_price < 50 else 5.0
    is_overheated = bias > bias_limit

    if is_overheated:
        reasons.append(f"⚠️ 乖離濾網：正乖離達 +{bias}%，短線過熱嚴防追高被套")

    score = max(0, min(100, score))
    can_enter = score >= 75 and not is_overheated and market["is_bull"]

    if can_enter:
        action = "可進場"
        suggested_entry = round(max(ma5, current_price * 0.995), 2)
        stop_loss = round(suggested_entry - 1.5 * latest_atr, 2)
        take_profit = round(suggested_entry + 3.0 * latest_atr, 2)
    elif is_overheated and score >= 65:
        action = "強勢 (防追高，等拉回)"
        suggested_entry = round(ma5, 2)
        stop_loss = round(suggested_entry - 1.5 * latest_atr, 2)
        take_profit = round(suggested_entry + 3.0 * latest_atr, 2)
    elif not market["is_bull"] and score >= 65:
        action = "大盤偏空 (建議觀望)"
        suggested_entry = round(ma20, 2)
        stop_loss = round(suggested_entry - 1.5 * latest_atr, 2)
        take_profit = round(suggested_entry + 3.0 * latest_atr, 2)
    elif score <= 40:
        action = "建議出場/空手"
        suggested_entry = 0.0
        stop_loss = round(current_price - 1.5 * latest_atr, 2)
        take_profit = 0.0
    else:
        action = "觀望等待"
        suggested_entry = round(ma20 * 1.005, 2)
        stop_loss = round(suggested_entry - 1.5 * latest_atr, 2)
        take_profit = round(suggested_entry + 2.5 * latest_atr, 2)

    chart_data = []
    markers = []
    for _, row in processed_df.iterrows():
        chart_data.append({
            "time": row["date"],
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2),
        })
        if row["signal"] == "BUY":
            markers.append({
                "time": row["date"], "position": "belowBar",
                "color": "#26a69a", "shape": "arrowUp", "text": "BUY"
            })
        elif row["signal"] == "SELL":
            markers.append({
                "time": row["date"], "position": "aboveBar",
                "color": "#ef5350", "shape": "arrowDown", "text": "SELL"
            })

    return {
        "symbol": clean_symbol,
        "market": market,
        "decision": {
            "can_enter": can_enter,
            "action": action,
            "score": score,
            "current_price": current_price,
            "bias": bias,
            "atr": latest_atr,
            "suggested_entry_price": suggested_entry,
            "stop_loss_price": stop_loss,
            "take_profit_price": take_profit,
            "institutional": inst,
            "reasons": reasons
        },
        "kline": chart_data,
        "markers": markers
    }
