import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { Loading } from "./components/ui";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

const Findings = lazy(() => import("./pages/Findings"));
const LeaderboardPage = lazy(() => import("./pages/Leaderboard"));
const DeepDive = lazy(() => import("./pages/DeepDive"));
const Accuracy = lazy(() => import("./pages/Accuracy"));
const Regimes = lazy(() => import("./pages/Regimes"));
const Robustness = lazy(() => import("./pages/Robustness"));
const Compare = lazy(() => import("./pages/Compare"));
const Methodology = lazy(() => import("./pages/Methodology"));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Findings />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="strategy" element={<DeepDive />} />
              <Route path="strategy/:id" element={<DeepDive />} />
              <Route path="accuracy" element={<Accuracy />} />
              <Route path="regimes" element={<Regimes />} />
              <Route path="robustness" element={<Robustness />} />
              <Route path="compare" element={<Compare />} />
              <Route path="methodology" element={<Methodology />} />
              <Route path="*" element={<Findings />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
