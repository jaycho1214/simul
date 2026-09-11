/* Temporary. Picker directions for review only — never imported by the app. */
import type { Brand } from "./config.ts";
import type { LanguageRow } from "./languages.ts";
import { S, bilingual } from "./strings.ts";
import { BrandBar } from "./components/BrandBar.tsx";

const css = `
/* ---- B: channel tiles ---- */
.vb { display:flex; flex-direction:column; min-height:100%; }
.vb-head { padding: 1.5rem var(--gutter) 1rem; }
.vb-eyebrow { margin:0; font-size:var(--t-sm); font-weight:600; color:var(--ink-quiet);
  letter-spacing:.02em; }
.vb-prompt { margin:.15rem 0 0; font-size:var(--t-xl); font-weight:680;
  letter-spacing:-.024em; line-height:1.15; }
.vb-grid { list-style:none; margin:0; padding:0 var(--gutter) var(--gap-4);
  display:grid; grid-template-columns:1fr 1fr; gap:.625rem; }
.vb-cell--wide { grid-column:1 / -1; }
.vb-tile { display:flex; flex-direction:column; justify-content:flex-end; gap:.35rem;
  width:100%; min-height:6.5rem; padding:1rem; border:1px solid var(--rule);
  border-radius:var(--r-lg); background:var(--raise); text-align:left; }
.vb-tile:active { border-color:var(--ink-faint); }
.vb-tile--source { border-color:var(--accent); background:var(--accent-wash); }
.vb-name { font-size:1.75rem; font-weight:640; letter-spacing:-.024em; line-height:1.1;
  overflow-wrap:anywhere; }
.vb-tag { font-size:var(--t-xs); font-weight:600; color:var(--accent-text); }

/* ---- C: editorial ---- */
.vc { display:flex; flex-direction:column; min-height:100%; }
.vc-head { padding: 1.75rem var(--gutter) .75rem; }
.vc-prompt { margin:0; font-size:var(--t-lg); font-weight:600; letter-spacing:-.014em;
  line-height:1.2; }
.vc-prompt-en { display:block; font-size:var(--t-md); font-weight:450; color:var(--ink-quiet); }
.vc-rows { list-style:none; margin:0; padding:.5rem 0 var(--gap-4); }
.vc-row { display:flex; align-items:baseline; gap:.7rem; width:100%;
  padding:.5rem var(--gutter); text-align:left; }
.vc-row:active { background:var(--raise); }
.vc-name { font-size:2.75rem; font-weight:700; letter-spacing:-.035em; line-height:1.16;
  overflow-wrap:anywhere; }
.vc-row--source .vc-name { color:var(--accent-text); }
.vc-tag { font-size:var(--t-xs); font-weight:600; color:var(--ink-quiet); white-space:nowrap; }
`;

export function VariantB({ brand, rows }: { brand: Brand; rows: LanguageRow[] }) {
  const p = bilingual(S.pickLanguage);
  return (
    <main className="vb">
      <style>{css}</style>
      <BrandBar brand={brand} />
      <div className="vb-head">
        <p className="vb-eyebrow">{p.en}</p>
        <h1 className="vb-prompt">{p.ko}</h1>
      </div>
      <ul className="vb-grid">
        {rows.map((r) => (
          <li key={r.lang} className={r.isPassthrough ? "vb-cell--wide" : undefined}>
            <button
              type="button"
              className={r.isPassthrough ? "vb-tile vb-tile--source" : "vb-tile"}
            >
              <span className="vb-name" lang={r.lang}>
                {r.endonym}
              </span>
              {r.tag ? <span className="vb-tag">{r.tag}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}

export function VariantC({ brand, rows }: { brand: Brand; rows: LanguageRow[] }) {
  const p = bilingual(S.pickLanguage);
  return (
    <main className="vc">
      <style>{css}</style>
      <BrandBar brand={brand} />
      <div className="vc-head">
        <h1 className="vc-prompt">
          {p.ko}
          <span className="vc-prompt-en">{p.en}</span>
        </h1>
      </div>
      <ul className="vc-rows">
        {rows.map((r) => (
          <li key={r.lang}>
            <button type="button" className={r.isPassthrough ? "vc-row vc-row--source" : "vc-row"}>
              <span className="vc-name" lang={r.lang}>
                {r.endonym}
              </span>
              {r.tag ? <span className="vc-tag">{r.tag}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
