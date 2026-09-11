import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyDocumentBranding, DEFAULT_BRANDING } from "./config/branding";
import "./index.css";

applyDocumentBranding(DEFAULT_BRANDING);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
