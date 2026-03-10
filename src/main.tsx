import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import { DetachedNodeDetail } from "./components/panels/DetachedNodeDetail";
import { AgentConsole } from "./components/panels/AgentConsole";
import { ManualWindow } from "./components/panels/ManualWindow";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/node-detail/:nodeId/:layerId"
          element={<DetachedNodeDetail />}
        />
        <Route path="/agent-console" element={<AgentConsole />} />
        <Route path="/manual" element={<ManualWindow />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>,
);
