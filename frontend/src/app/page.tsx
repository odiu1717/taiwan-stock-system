"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  IChartApi,
  ISeriesApi
} from "lightweight-charts";

interface Market {
  name: string;
  close: number;
  ma20: number;
  is_bull: boolean;
  status: string;
}

interface Decision {
  can_enter: boolean;
  action: string;
  score: number;
  current_price: number;
  bias: number;
  atr: number;
  suggested_entry_price: number;
  stop_loss_price: number;
  take_profit_price: number;
  institutional: {
    available: boolean;
    foreign: number;
    trust: number;
    dealer: number;
    total: number;
  };
  reasons: string[];
}

export default function StockDashboard() {
  const [mounted, setMounted] = useState(false);
  const [symbol, setSymbol] = useState("2330");
  const [inputSymbol, setInputSymbol] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([
    "2330", "2317", "2454", "0050", "00631L", "00937B"
  ]);
  const [market, setMarket] = useState<Market | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(false);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<any>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchStockData = async (targetSymbol: string) => {
    setLoading(true);
    setSymbol(targetSymbol);
    try {
      // 優先使用雲端環境變數，本機則回退至 localhost:8000
      const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const res = await fetch(`${apiBase}/api/v1/stocks/${targetSymbol}/kline`);
      if (!res.ok) throw new Error("取得股票資料失敗");
      const data = await res.json();

      setMarket(data.market);
      setDecision(data.decision);

      if (seriesRef.current) {
        seriesRef.current.setData(data.kline);
        if (markersRef.current) {
          markersRef.current.setMarkers(data.markers);
        } else {
          markersRef.current = createSeriesMarkers(seriesRef.current, data.markers);
        }
      }
    } catch (err) {
      alert("無法載入資料，請確認後端運行狀態");
    } finally {
      setLoading(false);
    }
  };

  const addToWatchlist = () => {
    const code = inputSymbol.trim().toUpperCase();
    if (code && !watchlist.includes(code)) {
      setWatchlist([...watchlist, code]);
      setInputSymbol("");
    }
  };

  const removeFromWatchlist = (codeToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setWatchlist(watchlist.filter((item) => item !== codeToRemove));
  };

  useEffect(() => {
    if (!mounted || !chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 460,
      layout: { background: { color: "#ffffff" }, textColor: "#333333" },
      grid: { vertLines: { color: "#f3f4f6" }, horzLines: { color: "#f3f4f6" } },
      timeScale: { borderColor: "#e5e7eb" },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#ef5350",
      downColor: "#26a69a",
      borderUpColor: "#ef5350",
      borderDownColor: "#26a69a",
      wickUpColor: "#ef5350",
      wickDownColor: "#26a69a",
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    fetchStockData("2330");

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-500 text-sm">
        載入系統中...
      </div>
    );
  }

  return (
    <main className="p-4 md:p-6 max-w-6xl mx-auto font-sans bg-gray-50 min-h-screen">
      <header className="mb-4">
        <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight">
          台股進退場量化決策系統
        </h1>
        <p className="text-xs md:text-sm text-gray-500 mt-1">
          大盤多空濾網 + 乖離防追高 + ATR動態停損 + 三大法人籌碼
        </p>
      </header>

      {market && (
        <div
          className={`p-3 rounded-xl border mb-4 text-xs md:text-sm flex flex-col md:flex-row md:items-center justify-between gap-2 ${
            market.is_bull
              ? "bg-green-50 border-green-200 text-green-900"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-bold">{market.is_bull ? "🟢" : "🔴"} 大盤環境：</span>
            <span>{market.status}</span>
          </div>
          {market.close > 0 && (
            <div className="font-semibold text-gray-600">
              加權指數: {market.close.toLocaleString()} | 20MA: {market.ma20.toLocaleString()}
            </div>
          )}
        </div>
      )}

      {/* 觀察名單隨點隨換區 */}
      <section className="bg-white p-4 rounded-xl shadow-sm border border-gray-200 mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs md:text-sm font-semibold text-gray-700">
            ⭐ 追蹤觀察名單：
          </span>
          <div className="flex gap-1.5">
            <input
              type="text"
              placeholder="代碼 (例: 2454)"
              className="border border-gray-300 px-2 py-1 text-xs rounded-lg w-28 text-gray-800 focus:outline-blue-500"
              value={inputSymbol}
              onChange={(e) => setInputSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addToWatchlist()}
            />
            <button
              onClick={addToWatchlist}
              className="bg-gray-800 text-white text-xs px-2.5 py-1 rounded-lg hover:bg-black"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {watchlist.map((code) => (
            <div
              key={code}
              onClick={() => fetchStockData(code)}
              className={`cursor-pointer px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition flex items-center gap-1.5 border ${
                symbol === code
                  ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200 border-gray-200"
              }`}
            >
              <span>{code}</span>
              <button
                onClick={(e) => removeFromWatchlist(code, e)}
                className="text-xs hover:text-red-400 font-bold ml-0.5"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 決策看板四大卡片 */}
      {decision && (
        <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">進場信心指數</div>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className="text-3xl font-extrabold text-gray-900">{decision.score}</span>
              <span className="text-gray-400 text-xs">/ 100 分</span>
            </div>
            <div className="mt-2">
              <span
                className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  decision.can_enter
                    ? "bg-green-100 text-green-700"
                    : decision.action.includes("防追高")
                    ? "bg-orange-100 text-orange-700"
                    : decision.score <= 40
                    ? "bg-red-100 text-red-700"
                    : "bg-yellow-100 text-yellow-800"
                }`}
              >
                ● {decision.action}
              </span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">建議掛單買進價</div>
            <div className="text-2xl font-extrabold text-blue-600 mt-1.5">
              {decision.suggested_entry_price > 0 ? `$${decision.suggested_entry_price}` : "暫不建議進場"}
            </div>
            <div className="flex justify-between items-center text-xs mt-1.5 text-gray-500">
              <span>現價: ${decision.current_price}</span>
              <span className={decision.bias > 0 ? "text-red-500 font-semibold" : "text-green-600 font-semibold"}>
                乖離: {decision.bias > 0 ? `+${decision.bias}%` : `${decision.bias}%`}
              </span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase">ATR 動態風控 (14日)</div>
            <div className="mt-1.5 space-y-1 text-xs">
              <div className="flex justify-between text-gray-600">
                <span>停損防守價:</span>
                <span className="font-bold text-red-600">${decision.stop_loss_price}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>目標停利價:</span>
                <span className="font-bold text-green-600">
                  {decision.take_profit_price > 0 ? `$${decision.take_profit_price}` : "--"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">策略診斷分析</div>
            <ul className="text-xs text-gray-600 space-y-1 max-h-24 overflow-y-auto">
              {decision.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-1">
                  • <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* K 線圖 */}
      <section className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-sm md:text-base font-bold text-gray-800">
            {symbol} 日 K 線圖（包含 BUY / SELL 標記）
          </h2>
          {loading && <span className="text-xs text-blue-500 font-semibold animate-pulse">計算中...</span>}
        </div>
        <div ref={chartContainerRef} className="rounded-lg overflow-hidden" />
      </section>
    </main>
  );
}
