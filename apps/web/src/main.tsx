import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toasts";
import { initTheme } from "./lib/theme";
import { VaultProvider } from "./state/vault";
import "./styles.css";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("Root element is missing");

createRoot(root).render(
  <StrictMode>
    <ToastProvider>
      <VaultProvider>
        <App />
      </VaultProvider>
    </ToastProvider>
  </StrictMode>,
);
