import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import MacroApp from "./MacroApp.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <MacroApp />
  </StrictMode>,
);
