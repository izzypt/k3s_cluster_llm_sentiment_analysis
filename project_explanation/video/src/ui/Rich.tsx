import React from "react";
import { C, MONO } from "../theme";

/** Inline markup for captions and labels: `code`, **bold**, ==accent== */
export const Rich: React.FC<{ text: string; codeColor?: string }> = ({ text, codeColor = C.accent }) => {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|==[^=]+==)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`"))
          return (
            <span key={i} style={{ fontFamily: MONO, fontSize: "0.86em", color: codeColor, background: "rgba(255,255,255,0.07)", padding: "0.05em 0.3em", borderRadius: 6 }}>
              {p.slice(1, -1)}
            </span>
          );
        if (p.startsWith("**")) return <strong key={i} style={{ fontWeight: 700, color: "#fff" }}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("==")) return <span key={i} style={{ color: C.accent, fontWeight: 600 }}>{p.slice(2, -2)}</span>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
};
