import { Route, Routes } from "react-router-dom";
import { AboutPage } from "./pages/about.tsx";
import { HomePage } from "./pages/home.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/about" element={<AboutPage />} />
    </Routes>
  );
}
