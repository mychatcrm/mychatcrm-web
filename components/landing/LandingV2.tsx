"use client";

/**
 * Landing pública (home) — reconstruída do zero em 01/09/2026.
 *
 * Direção: "sala de controle". O produto é um agente comercial autónomo que
 * roda 24/7; a página mostra a máquina a funcionar em vez de a descrever.
 * Fundo escuro instrumentado, laranja da marca (#F24400) como único acento
 * forte, verde só para estado "ao vivo".
 *
 * Por que CSS próprio em vez de Tailwind puro: `.brand-marketing` (globals.css)
 * força Inter, tamanhos de h1/h2/h3 e `box-shadow: none !important` em todas as
 * páginas públicas. Reescrever aquilo mexeria em /planos, /blog, /login e
 * /checkout. Aqui a folha é escopada em `.mcx` com especificidade de duas
 * classes, que ganha de `.brand-marketing main h1` sem tocar em nada global.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  Columns3,
  Cpu,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  Plug,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  X as CloseIcon,
} from "lucide-react";
import { SALES_PLANS, PLAN_ANNUAL_DISCOUNT_PERCENT, planEffectiveMonthlyBRL } from "@/lib/plans";
import { SOCIAL_LINKS } from "@/lib/social-links";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";

// ---------------------------------------------------------------------------
// Folha de estilo escopada
// ---------------------------------------------------------------------------

const SHEET = `
.mcx{
  --ground:#05080B;
  --ground-2:#080E14;
  --surface:#0C131B;
  --surface-2:#111B25;
  --coal:#0E1D29;
  --line:rgba(255,255,255,.09);
  --line-strong:rgba(255,255,255,.17);
  --text:#EDF3F8;
  --muted:#94A5B4;
  --faint:#5F7284;
  --brand:#F24400;
  --brand-hi:#FF7A3D;
  --brand-dim:rgba(242,68,0,.13);
  --brand-glow:rgba(242,68,0,.42);
  /* verde da marca (#00A650) elevado para ler sobre fundo quase preto */
  --live:#19CE72;
  --live-dim:rgba(25,206,114,.13);
  --f-display:var(--font-brand-display),var(--font-brand-body),ui-sans-serif,system-ui,sans-serif;
  --f-body:var(--font-brand-body),ui-sans-serif,system-ui,sans-serif;
  --f-mono:ui-monospace,"SF Mono",SFMono-Regular,"Roboto Mono",Menlo,Consolas,monospace;

  background:var(--ground);
  color:var(--text);
  font-family:var(--f-body);
  min-height:100dvh;
  position:relative;
  isolation:isolate;
  overflow-x:clip;
}

/* A home é escura ponta a ponta; sem isto o overscroll mostra o cinza do body. */
body:has(.mcx){ background:#05080B; }

.mcx *,.mcx *::before,.mcx *::after{ box-sizing:border-box; }
.mcx ::selection{ background:var(--brand); color:#fff; }

.mcx .mcx-shell{ max-width:1240px; margin:0 auto; padding:0 24px; }
@media (max-width:720px){ .mcx .mcx-shell{ padding:0 18px; } }

/* ---- tipografia ---------------------------------------------------------- */
.mcx .mcx-h1{
  font-family:var(--f-display);
  font-weight:700;
  font-size:clamp(2.4rem,5.2vw,4.05rem);
  line-height:1.0;
  letter-spacing:-.038em;
  margin:0;
  text-wrap:balance;
  color:var(--text);
}
.mcx .mcx-h2{
  font-family:var(--f-display);
  font-weight:700;
  font-size:clamp(1.85rem,3.7vw,2.9rem);
  line-height:1.06;
  letter-spacing:-.03em;
  margin:0;
  text-wrap:balance;
  color:var(--text);
}
.mcx .mcx-h3{
  font-family:var(--f-display);
  font-weight:600;
  font-size:1.06rem;
  line-height:1.28;
  letter-spacing:-.014em;
  margin:0;
  color:var(--text);
}
.mcx .mcx-lead{
  font-size:clamp(1.02rem,1.35vw,1.19rem);
  line-height:1.6;
  color:var(--muted);
  margin:0;
  max-width:60ch;
}
.mcx .mcx-body{ font-size:.95rem; line-height:1.62; color:var(--muted); margin:0; }
.mcx .mcx-mono{
  font-family:var(--f-mono);
  font-size:11px;
  letter-spacing:.15em;
  text-transform:uppercase;
  color:var(--faint);
}
.mcx .mcx-accent{ color:var(--brand); }
.mcx .mcx-num{ font-variant-numeric:tabular-nums; }

/* ---- rótulo de secção ---------------------------------------------------- */
.mcx .mcx-seclabel{ display:flex; align-items:center; gap:14px; margin-bottom:18px; }
.mcx .mcx-seclabel span{
  font-family:var(--f-mono); font-size:11px; letter-spacing:.19em;
  text-transform:uppercase; color:var(--brand); white-space:nowrap;
}
.mcx .mcx-seclabel i{
  flex:1; height:1px;
  background:linear-gradient(90deg,var(--line-strong),transparent);
}

/* ---- superfícies --------------------------------------------------------- */
.mcx .mcx-card{
  background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));
  border:1px solid var(--line);
  border-radius:16px;
  position:relative;
  overflow:hidden;
}
.mcx .mcx-card::before{
  content:""; position:absolute; inset:0 0 auto 0; height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent);
}
.mcx .mcx-panel{
  background:var(--surface);
  border:1px solid var(--line);
  border-radius:18px;
}

/* ---- grelha técnica de fundo -------------------------------------------- */
.mcx .mcx-grid{
  position:absolute; inset:0; pointer-events:none; z-index:0;
  background-image:
    linear-gradient(rgba(255,255,255,.038) 1px,transparent 1px),
    linear-gradient(90deg,rgba(255,255,255,.038) 1px,transparent 1px);
  background-size:64px 64px;
  mask-image:radial-gradient(120% 80% at 50% 0%,#000 20%,transparent 78%);
  -webkit-mask-image:radial-gradient(120% 80% at 50% 0%,#000 20%,transparent 78%);
}
.mcx .mcx-aurora{
  position:absolute; pointer-events:none; z-index:0; border-radius:50%;
  filter:blur(90px);
}

/* ---- botões -------------------------------------------------------------- */
.mcx .mcx-btn{
  display:inline-flex; align-items:center; justify-content:center; gap:9px;
  font-family:var(--f-body); font-weight:600; font-size:.95rem;
  padding:14px 24px; border-radius:12px; border:1px solid transparent;
  text-decoration:none; cursor:pointer; white-space:nowrap;
  transition:transform .16s ease,box-shadow .22s ease,background .18s ease,border-color .18s ease;
}
.mcx .mcx-btn:active{ transform:translateY(1px) scale(.99); }
.mcx .mcx-btn-primary{
  background:linear-gradient(180deg,var(--brand-hi),var(--brand));
  color:#fff;
  box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 10px 34px -12px var(--brand-glow) !important;
}
.mcx .mcx-btn-primary:hover{
  box-shadow:0 1px 0 rgba(255,255,255,.28) inset,0 16px 44px -12px var(--brand-glow) !important;
}
.mcx .mcx-btn-ghost{
  background:rgba(255,255,255,.045);
  border-color:var(--line-strong);
  color:var(--text);
}
.mcx .mcx-btn-ghost:hover{ background:rgba(255,255,255,.085); border-color:rgba(255,255,255,.3); }
.mcx .mcx-btn-lg{ padding:17px 30px; font-size:1.02rem; border-radius:14px; }
.mcx a:focus-visible,.mcx button:focus-visible,.mcx input:focus-visible{
  outline:2px solid var(--brand-hi); outline-offset:3px; border-radius:10px;
}

/* ---- chips --------------------------------------------------------------- */
.mcx .mcx-chip{
  display:inline-flex; align-items:center; gap:8px;
  padding:7px 14px 7px 11px; border-radius:999px;
  border:1px solid var(--line-strong);
  background:rgba(255,255,255,.04);
  font-family:var(--f-mono); font-size:10.5px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--muted);
}
.mcx .mcx-dot{
  width:6px; height:6px; border-radius:50%; background:var(--live);
  box-shadow:0 0 0 0 rgba(25,206,114,.55);
}
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-dot{ animation:mcx-ping 2.4s ease-out infinite; }
}
@keyframes mcx-ping{
  0%{ box-shadow:0 0 0 0 rgba(25,206,114,.5); }
  70%{ box-shadow:0 0 0 7px rgba(25,206,114,0); }
  100%{ box-shadow:0 0 0 0 rgba(25,206,114,0); }
}

/* ---- nav ----------------------------------------------------------------- */
.mcx .mcx-nav{
  position:sticky; top:0; z-index:60;
  border-bottom:1px solid var(--line);
  background:rgba(5,8,11,.72);
  backdrop-filter:blur(16px) saturate(150%);
  -webkit-backdrop-filter:blur(16px) saturate(150%);
}
.mcx .mcx-navrow{ display:flex; align-items:center; justify-content:space-between; height:68px; gap:20px; }
.mcx .mcx-navlinks{ display:none; align-items:center; gap:30px; }
@media (min-width:1024px){ .mcx .mcx-navlinks{ display:flex; } }
.mcx .mcx-navlink{
  font-size:.9rem; font-weight:500; color:var(--muted); text-decoration:none;
  position:relative; padding:4px 0; transition:color .18s ease;
}
.mcx .mcx-navlink:hover{ color:var(--text); }
.mcx .mcx-navlink::after{
  content:""; position:absolute; left:0; right:100%; bottom:0; height:1px;
  background:var(--brand); transition:right .26s cubic-bezier(.22,1,.36,1);
}
.mcx .mcx-navlink:hover::after{ right:0; }
.mcx .mcx-navcta{ display:none; align-items:center; gap:14px; }
@media (min-width:1024px){ .mcx .mcx-navcta{ display:flex; } }
.mcx .mcx-burger{
  display:inline-flex; align-items:center; justify-content:center;
  width:42px; height:42px; border-radius:11px;
  border:1px solid var(--line-strong); background:rgba(255,255,255,.04);
  color:var(--text); cursor:pointer;
}
@media (min-width:1024px){ .mcx .mcx-burger{ display:none; } }
.mcx .mcx-mobilemenu{
  border-top:1px solid var(--line);
  background:rgba(5,8,11,.97);
  overflow:hidden;
}
.mcx .mcx-mobilemenu a{
  display:block; padding:15px 0; text-decoration:none;
  color:var(--text); font-size:1rem; font-weight:500;
  border-bottom:1px solid var(--line);
}

/* ---- marca --------------------------------------------------------------- */
.mcx .mcx-wordmark{
  font-family:var(--f-display); font-weight:700; font-size:1.14rem;
  letter-spacing:-.026em; color:var(--text);
}

/* ---- consola do hero ------------------------------------------------------ */
.mcx .mcx-console{
  background:linear-gradient(180deg,#0B121A,#070C11);
  border:1px solid var(--line-strong);
  border-radius:18px;
  overflow:hidden;
  box-shadow:0 40px 90px -50px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.03) inset !important;
}
.mcx .mcx-console-bar{
  display:flex; align-items:center; gap:10px;
  padding:12px 16px; border-bottom:1px solid var(--line);
  background:rgba(255,255,255,.022);
}
.mcx .mcx-trace{
  display:grid; grid-template-columns:26px 1fr auto; gap:12px; align-items:center;
  padding:9px 16px; border-bottom:1px solid rgba(255,255,255,.05);
  font-family:var(--f-mono); font-size:11.5px;
}
.mcx .mcx-trace:last-child{ border-bottom:0; }
.mcx .mcx-trace-idx{ color:var(--faint); }
.mcx .mcx-trace-name{ color:var(--muted); letter-spacing:.06em; text-transform:uppercase; font-size:10.5px; }
.mcx .mcx-trace-note{ color:var(--faint); font-size:11px; }
.mcx .mcx-trace.on .mcx-trace-name{ color:var(--text); }
.mcx .mcx-trace.on .mcx-trace-idx{ color:var(--brand); }
.mcx .mcx-bubble{
  border-radius:14px; padding:11px 14px; font-size:.895rem; line-height:1.5;
  max-width:88%;
}
.mcx .mcx-bubble-in{
  background:var(--surface-2); border:1px solid var(--line);
  color:var(--text); border-bottom-left-radius:5px;
}
.mcx .mcx-bubble-out{
  background:linear-gradient(160deg,rgba(242,68,0,.19),rgba(242,68,0,.09));
  border:1px solid rgba(242,68,0,.36);
  color:var(--text); border-bottom-right-radius:5px; margin-left:auto;
}
.mcx .mcx-caret{
  display:inline-block; width:2px; height:1em; background:var(--brand);
  vertical-align:-2px; margin-left:2px;
}
/* em ecrãs muito estreitos os dois rótulos da barra partem-se em duas linhas cada */
.mcx .mcx-console-bar span{ white-space:nowrap; }
@media (max-width:420px){ .mcx .mcx-console-bar .mcx-console-provider{ display:none; } }

/* separadores de cenário — o visitante pode saltar para qualquer demonstração */
.mcx .mcx-console-tabs{
  display:flex; gap:6px; padding:10px 12px; overflow-x:auto;
  border-bottom:1px solid var(--line); background:rgba(255,255,255,.015);
  scrollbar-width:none;
}
.mcx .mcx-console-tabs::-webkit-scrollbar{ display:none; }
.mcx .mcx-tab{
  flex:0 0 auto; cursor:pointer; white-space:nowrap;
  border:1px solid var(--line); background:transparent; color:var(--faint);
  border-radius:999px; padding:5px 12px;
  font-family:var(--f-mono); font-size:10px; letter-spacing:.12em; text-transform:uppercase;
  transition:color .16s ease,border-color .16s ease,background .16s ease;
}
.mcx .mcx-tab:hover{ color:var(--muted); border-color:var(--line-strong); }
.mcx .mcx-tab.on{
  color:var(--brand-hi); border-color:rgba(242,68,0,.45); background:var(--brand-dim);
}
.mcx .mcx-console-claim{
  display:flex; align-items:center; gap:8px;
  padding:11px 16px; border-bottom:1px solid var(--line);
  font-size:.85rem; color:var(--text);
}
.mcx .mcx-console-thread{
  padding:16px; display:flex; flex-direction:column; gap:8px; min-height:88px;
}
.mcx .mcx-console-system{
  display:flex; align-items:center; gap:12px; padding:2px 0 6px;
  font-family:var(--f-mono); font-size:10px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--faint);
}
.mcx .mcx-console-system i{ flex:1; height:1px; background:var(--line); }
.mcx .mcx-console-trace{ border-top:1px solid var(--line); }
.mcx .mcx-console-reply{
  padding:14px 16px 18px; border-top:1px solid var(--line); min-height:118px;
}
.mcx .mcx-bubble-media{
  display:inline-flex; align-items:center; gap:7px;
  font-family:var(--f-mono); font-size:11px; letter-spacing:.06em; color:var(--muted);
}
.mcx .mcx-hold{
  height:2px; border-radius:99px; background:var(--line); overflow:hidden; margin-top:4px;
}
.mcx .mcx-hold i{
  display:block; height:100%; width:0;
  background:linear-gradient(90deg,var(--brand),var(--brand-hi));
  animation-name:mcx-hold; animation-timing-function:linear; animation-fill-mode:forwards;
}
@keyframes mcx-hold{ to{ width:100%; } }
.mcx .mcx-attach{
  display:inline-flex; align-items:center; gap:8px; align-self:flex-end;
  border:1px solid rgba(242,68,0,.34); background:var(--brand-dim);
  color:var(--brand-hi); border-radius:9px; padding:7px 11px;
  font-family:var(--f-mono); font-size:10.5px;
}

@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-caret{ animation:mcx-blink 1.05s steps(2) infinite; }
}
@keyframes mcx-blink{ 50%{ opacity:0; } }

/* ---- hero (grelha + deriva da aurora) ------------------------------------ */
@keyframes mcx-float{ to{ transform:translate(6%,7%) scale(1.1); } }
.mcx .mcx-hero > *{ min-width:0; }
.mcx .mcx-console{ min-width:0; max-width:100%; }
@media (min-width:1080px){
  .mcx .mcx-hero{ grid-template-columns:1.14fr .86fr; }
}

/* ---- ticker -------------------------------------------------------------- */
.mcx .mcx-ticker{
  border-top:1px solid var(--line); border-bottom:1px solid var(--line);
  background:rgba(255,255,255,.018); overflow:hidden;
  mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);
}
.mcx .mcx-ticker-row{ display:flex; width:max-content; }
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-ticker-row{ animation:mcx-slide 42s linear infinite; }
}
@keyframes mcx-slide{ to{ transform:translateX(-50%); } }
.mcx .mcx-ticker-item{
  display:inline-flex; align-items:center; gap:10px;
  padding:14px 26px; white-space:nowrap;
  font-family:var(--f-mono); font-size:11px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--faint);
}
.mcx .mcx-ticker-item b{ color:var(--brand); font-weight:500; }

/* ---- pipeline ------------------------------------------------------------ */
.mcx .mcx-pipe{ display:grid; gap:14px; grid-template-columns:1fr; }
@media (min-width:760px){ .mcx .mcx-pipe{ grid-template-columns:repeat(2,1fr); } }
@media (min-width:1080px){ .mcx .mcx-pipe{ grid-template-columns:repeat(3,1fr); } }
.mcx .mcx-node{ padding:22px; display:flex; flex-direction:column; gap:11px; }
.mcx .mcx-node-top{ display:flex; align-items:center; justify-content:space-between; }
.mcx .mcx-node-idx{
  font-family:var(--f-mono); font-size:11px; letter-spacing:.16em; color:var(--brand);
}
.mcx .mcx-node-ico{
  width:34px; height:34px; border-radius:10px;
  display:flex; align-items:center; justify-content:center;
  background:var(--brand-dim); border:1px solid rgba(242,68,0,.28); color:var(--brand-hi);
}

/* ---- bento --------------------------------------------------------------- */
.mcx .mcx-bento{ display:grid; gap:14px; grid-template-columns:1fr; }
@media (min-width:720px){ .mcx .mcx-bento{ grid-template-columns:repeat(2,1fr); } }
@media (min-width:1080px){ .mcx .mcx-bento{ grid-template-columns:repeat(6,1fr); } }
.mcx .mcx-b-lg,.mcx .mcx-b-md,.mcx .mcx-b-full{ grid-column:span 1; }
@media (min-width:720px){ .mcx .mcx-b-full{ grid-column:span 2; } }
@media (min-width:1080px){
  .mcx .mcx-b-lg{ grid-column:span 4; }
  .mcx .mcx-b-md{ grid-column:span 2; }
  .mcx .mcx-b-full{ grid-column:span 6; }
}
.mcx .mcx-tile{ padding:24px; display:flex; flex-direction:column; gap:13px; min-height:210px; }
.mcx .mcx-tile-ico{
  width:38px; height:38px; border-radius:11px;
  display:flex; align-items:center; justify-content:center;
  background:rgba(255,255,255,.05); border:1px solid var(--line-strong); color:var(--brand-hi);
}

/* ---- mini-visuais -------------------------------------------------------- */
.mcx .mcx-kan{ display:grid; grid-template-columns:repeat(3,1fr); gap:7px; margin-top:auto; }
.mcx .mcx-kan-col{
  border:1px solid var(--line); border-radius:9px; padding:8px;
  background:rgba(255,255,255,.02); min-height:78px;
}
.mcx .mcx-kan-h{
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--faint); margin-bottom:7px;
}
.mcx .mcx-kan-card{
  height:15px; border-radius:5px; margin-bottom:5px;
  background:rgba(255,255,255,.07); border:1px solid var(--line);
}
.mcx .mcx-kan-card.hot{ background:var(--brand-dim); border-color:rgba(242,68,0,.34); }
.mcx .mcx-bars{ display:flex; align-items:flex-end; gap:5px; height:70px; margin-top:auto; }
.mcx .mcx-bar{ flex:1; border-radius:4px 4px 2px 2px; background:rgba(255,255,255,.1); }
.mcx .mcx-bar.on{ background:linear-gradient(180deg,var(--brand-hi),var(--brand)); }
.mcx .mcx-slots{ display:flex; flex-direction:column; gap:6px; margin-top:auto; }
.mcx .mcx-slot{
  display:flex; align-items:center; justify-content:space-between;
  border:1px solid var(--line); border-radius:8px; padding:7px 10px;
  font-family:var(--f-mono); font-size:10px; color:var(--faint);
  background:rgba(255,255,255,.02);
}
.mcx .mcx-slot.taken{
  border-color:rgba(242,68,0,.34); background:var(--brand-dim); color:var(--brand-hi);
}

/* ---- calculadora --------------------------------------------------------- */
.mcx .mcx-calc{ display:grid; gap:18px; grid-template-columns:1fr; }
@media (min-width:960px){ .mcx .mcx-calc{ grid-template-columns:1fr .92fr; } }
.mcx .mcx-field{ display:flex; flex-direction:column; gap:9px; padding:18px 0; border-bottom:1px solid var(--line); }
.mcx .mcx-field:last-of-type{ border-bottom:0; }
.mcx .mcx-field-top{ display:flex; align-items:baseline; justify-content:space-between; gap:14px; }
.mcx .mcx-field-lbl{ font-size:.92rem; color:var(--muted); }
.mcx .mcx-field-val{
  font-family:var(--f-mono); font-size:1rem; color:var(--text);
  font-variant-numeric:tabular-nums;
}
.mcx input[type=range]{
  -webkit-appearance:none; appearance:none; width:100%; height:4px; border-radius:99px;
  background:rgba(255,255,255,.13); outline:none; cursor:pointer;
}
.mcx input[type=range]::-webkit-slider-thumb{
  -webkit-appearance:none; appearance:none; width:19px; height:19px; border-radius:50%;
  background:var(--brand); border:3px solid #0B121A; cursor:grab;
  box-shadow:0 0 0 1px rgba(242,68,0,.5),0 0 18px var(--brand-glow) !important;
}
.mcx input[type=range]::-moz-range-thumb{
  width:19px; height:19px; border-radius:50%; background:var(--brand);
  border:3px solid #0B121A; cursor:grab;
}
.mcx .mcx-readout{
  padding:26px; display:flex; flex-direction:column; gap:8px;
  background:linear-gradient(165deg,rgba(242,68,0,.13),rgba(242,68,0,.03));
  border:1px solid rgba(242,68,0,.3);
}
.mcx .mcx-readout-big{
  font-family:var(--f-display); font-weight:700;
  font-size:clamp(2.1rem,5vw,3.05rem); line-height:1; letter-spacing:-.035em;
  color:var(--brand-hi); font-variant-numeric:tabular-nums;
}
.mcx .mcx-readout-split{
  display:grid; grid-template-columns:1fr 1fr; gap:1px;
  background:var(--line); border:1px solid var(--line); border-radius:12px;
  overflow:hidden; margin-top:6px;
}
.mcx .mcx-readout-cell{ background:var(--surface); padding:14px 16px; display:flex; flex-direction:column; gap:4px; }

/* ---- planos -------------------------------------------------------------- */
.mcx .mcx-toggle{
  display:inline-flex; padding:4px; gap:4px; border-radius:999px;
  border:1px solid var(--line-strong); background:rgba(255,255,255,.035);
}
.mcx .mcx-toggle button{
  border:0; cursor:pointer; border-radius:999px; padding:9px 20px;
  font-family:var(--f-body); font-size:.86rem; font-weight:600;
  background:transparent; color:var(--muted); transition:color .18s ease;
}
.mcx .mcx-toggle button.on{ background:var(--brand); color:#fff; }
.mcx .mcx-plans{ display:grid; gap:16px; grid-template-columns:1fr; align-items:start; }
@media (min-width:820px){ .mcx .mcx-plans{ grid-template-columns:repeat(2,1fr); } }
@media (min-width:1140px){ .mcx .mcx-plans{ grid-template-columns:repeat(4,1fr); } }
.mcx .mcx-plans > div,.mcx .mcx-pipe > div,.mcx .mcx-bento > div{ height:100%; }
.mcx .mcx-plan{ padding:26px 24px 24px; display:flex; flex-direction:column; gap:16px; height:100%; }
.mcx .mcx-plan-pop{
  border-color:rgba(242,68,0,.45);
  background:linear-gradient(180deg,rgba(242,68,0,.09),rgba(255,255,255,.012));
  box-shadow:0 30px 80px -50px var(--brand-glow) !important;
}
.mcx .mcx-plan-badge{
  position:absolute; top:0; right:20px;
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.16em; text-transform:uppercase;
  background:var(--brand); color:#fff; padding:5px 11px; border-radius:0 0 7px 7px;
}
.mcx .mcx-price{
  font-family:var(--f-display); font-weight:700;
  font-size:2.5rem; line-height:1; letter-spacing:-.035em;
  color:var(--text); font-variant-numeric:tabular-nums;
}
.mcx .mcx-plan-list{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:9px; }
.mcx .mcx-plan-list li{
  display:grid; grid-template-columns:16px 1fr; gap:9px;
  font-size:.855rem; line-height:1.45; color:var(--muted);
}
.mcx .mcx-plan-list svg{ margin-top:3px; color:var(--live); }
.mcx .mcx-plan-foot{ margin-top:auto; padding-top:6px; }

/* ---- faq ----------------------------------------------------------------- */
.mcx .mcx-faq-item{ border-bottom:1px solid var(--line); }
.mcx .mcx-faq-q{
  width:100%; display:flex; align-items:center; justify-content:space-between; gap:20px;
  background:none; border:0; cursor:pointer; text-align:left;
  padding:22px 0; color:var(--text);
  font-family:var(--f-display); font-weight:600; font-size:1.02rem; letter-spacing:-.012em;
}
.mcx .mcx-faq-q:hover{ color:var(--brand-hi); }
.mcx .mcx-faq-ico{ flex-shrink:0; color:var(--faint); transition:transform .24s ease,color .18s ease; }
.mcx .mcx-faq-q[aria-expanded=true] .mcx-faq-ico{ transform:rotate(180deg); color:var(--brand); }
.mcx .mcx-faq-a{ overflow:hidden; }
.mcx .mcx-faq-a p{ padding:0 0 22px; max-width:72ch; }

/* ---- cta final ----------------------------------------------------------- */
.mcx .mcx-final{
  position:relative; overflow:hidden; border-radius:24px;
  border:1px solid rgba(242,68,0,.32);
  background:linear-gradient(150deg,#12070300,#1A0A03 40%,#0A0F14);
  padding:clamp(38px,6vw,72px);
  text-align:center;
}

/* ---- rodapé -------------------------------------------------------------- */
.mcx .mcx-foot{ border-top:1px solid var(--line); background:var(--ground-2); }
.mcx .mcx-foot-grid{
  display:grid; gap:34px; grid-template-columns:1fr; padding:56px 0 34px;
}
@media (min-width:860px){ .mcx .mcx-foot-grid{ grid-template-columns:1.6fr 1fr 1fr 1fr; } }
.mcx .mcx-foot h4{
  font-family:var(--f-mono); font-size:10.5px; letter-spacing:.17em;
  text-transform:uppercase; color:var(--faint); margin:0 0 14px;
}
.mcx .mcx-foot ul{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:10px; }
.mcx .mcx-foot a{ color:var(--muted); text-decoration:none; font-size:.885rem; transition:color .16s ease; }
.mcx .mcx-foot a:hover{ color:var(--brand-hi); }
.mcx .mcx-social{ display:flex; gap:9px; }
.mcx .mcx-social a{
  width:36px; height:36px; border-radius:10px; display:flex; align-items:center; justify-content:center;
  border:1px solid var(--line-strong); background:rgba(255,255,255,.03); color:var(--muted);
}
.mcx .mcx-social a:hover{ color:var(--brand-hi); border-color:rgba(242,68,0,.4); background:var(--brand-dim); }
.mcx .mcx-foot-bar{
  border-top:1px solid var(--line); padding:20px 0 28px;
  display:flex; flex-wrap:wrap; gap:10px 22px; align-items:center; justify-content:space-between;
}
/* a barra fixa (só <900px) taparia a última linha do rodapé */
@media (max-width:899px){
  .mcx .mcx-foot-bar{ padding-bottom:calc(96px + env(safe-area-inset-bottom)); }
}

/* ---- barra fixa mobile --------------------------------------------------- */
.mcx .mcx-sticky{
  position:fixed; left:0; right:0; bottom:0; z-index:70;
  padding:11px 16px calc(11px + env(safe-area-inset-bottom));
  border-top:1px solid var(--line-strong);
  background:rgba(5,8,11,.94);
  backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px);
  display:flex; gap:10px; align-items:center;
}
@media (min-width:900px){ .mcx .mcx-sticky{ display:none; } }
.mcx .mcx-sticky .mcx-btn{ flex:1; padding:13px 16px; font-size:.9rem; }

@media (prefers-reduced-motion:reduce){
  .mcx *{ animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
}
`;

// ---------------------------------------------------------------------------
// Dados de página
// ---------------------------------------------------------------------------

const NAV_LINKS = [
  ["Como decide", "#motor"],
  ["Recursos", "#recursos"],
  ["Calculadora", "#calculadora"],
  ["Planos", "#planos"],
  ["Blog", "/blog"],
] as const;

/**
 * Formatação à mão, de propósito. `Intl.NumberFormat` devolve espaços diferentes
 * (U+00A0 vs U+202F) consoante a versão do ICU do Node e a do browser, o que
 * rebenta a hidratação nesta página — os valores são renderizados no servidor e
 * recalculados no cliente. Agrupar milhares em ponto é determinista.
 */
function groupDigits(value: number): string {
  const digits = Math.round(Math.abs(value)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return (value < 0 ? "-" : "") + out;
}

/** Valores redondos (calculadora): os cêntimos só fariam ruído. */
const BRL = { format: (v: number) => `R$ ${groupDigits(v)}` };
const NUM = { format: (v: number) => groupDigits(v) };

/**
 * Preços mostram cêntimos quando existem, para bater exatamente com o que a
 * página /planos apresenta (lá é `formatBRL`). O anual do Solo dá R$ 80,51 —
 * arredondar para R$ 81 mostrava um preço que o checkout não cobra.
 */
function priceBRL(value: number): string {
  const cents = Math.round(value * 100);
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  if (rest === 0) return `R$ ${groupDigits(whole)}`;
  return `R$ ${groupDigits(whole)},${String(rest).padStart(2, "0")}`;
}

/** Rola até a âncora na mão: o `next/link` do Next 14 nem sempre dispara o scroll de `#hash`. */
function useHashNav() {
  return useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!href.startsWith("#")) return;
    const el = document.querySelector(href);
    if (!el) return;
    event.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.pushState(null, "", href);
  }, []);
}

/**
 * Entrada em cena ao chegar à secção.
 *
 * Não usa `useInView`/IntersectionObserver de propósito: quando o visitante
 * salta muitos ecrãs de uma vez (roda rápida, tecla End, âncora do menu), o
 * observador não chega a registar a interseção e a secção fica invisível para
 * sempre — visto em produção. A verificação por `getBoundingClientRect` trata
 * os dois casos: o elemento que está a entrar e o que já foi ultrapassado.
 */
function useEnteredView(ref: React.RefObject<HTMLElement>) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (entered) return;
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const passou = rect.bottom < 0;
      const entrou = rect.top < window.innerHeight - 60;
      if (passou || entrou) setEntered(true);
    };
    check();
    const raf = requestAnimationFrame(check);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [entered, ref]);

  return entered;
}

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const entered = useEnteredView(ref);
  const reduced = useReducedMotion();
  const show = entered || reduced;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 22 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 }}
      transition={{ duration: reduced ? 0 : 0.55, delay: show && !reduced ? delay : 0, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mcx-seclabel">
      <span>{children}</span>
      <i />
    </div>
  );
}

function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="52" height="52" rx="15" fill="#F24400" />
      <rect x="6" y="6" width="52" height="52" rx="15" fill="url(#mcxlogo)" />
      <path d="M20 27h24M20 37h17" stroke="#FFFCF9" strokeWidth="5.5" strokeLinecap="round" />
      <defs>
        <linearGradient id="mcxlogo" x1="6" y1="6" x2="58" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff" stopOpacity=".28" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------

function Nav() {
  const [open, setOpen] = useState(false);
  const onHash = useHashNav();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <nav className="mcx-nav">
      <div className="mcx-shell mcx-navrow">
        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
          aria-label="MyChatCRM — início"
        >
          <LogoMark />
          <span className="mcx-wordmark">MyChatCRM</span>
        </Link>

        <div className="mcx-navlinks">
          {NAV_LINKS.map(([label, href]) => (
            <Link key={label} href={href} className="mcx-navlink" onClick={(e) => onHash(e, href)}>
              {label}
            </Link>
          ))}
        </div>

        <div className="mcx-navcta">
          <Link href="/login" className="mcx-navlink" style={{ fontWeight: 600 }}>
            Entrar
          </Link>
          <Link href="/planos" className="mcx-btn mcx-btn-primary" style={{ padding: "11px 20px" }}>
            Começar agora
          </Link>
        </div>

        <button
          type="button"
          className="mcx-burger"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
        >
          {open ? <CloseIcon size={19} /> : <Menu size={19} />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className="mcx-mobilemenu"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mcx-shell" style={{ paddingBottom: 22 }}>
              {NAV_LINKS.map(([label, href]) => (
                <Link
                  key={label}
                  href={href}
                  onClick={(e) => {
                    setOpen(false);
                    onHash(e, href);
                  }}
                >
                  {label}
                </Link>
              ))}
              <Link href="/login" onClick={() => setOpen(false)}>
                Entrar
              </Link>
              <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
                <Link
                  href="/planos"
                  className="mcx-btn mcx-btn-primary"
                  style={{ flex: 1 }}
                  onClick={() => setOpen(false)}
                >
                  Começar agora
                </Link>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Consola do hero — o agente a decidir, ao vivo
// ---------------------------------------------------------------------------

/**
 * Consola do hero — o agente a decidir, ao vivo.
 *
 * Os passos de cada cenário são os do motor real (`processAgentTurnV2` +
 * o contrato estruturado em `lib/ai/agent-turn-plan.ts`). O agente não só
 * agenda: ele agrupa rajadas, transcreve áudio, lê imagem, consulta a API do
 * próprio cliente, envia arquivos do catálogo autorizado, transfere para um
 * humano, encerra o lead com citação literal e volta sozinho no follow-up.
 * Cada cenário aqui é uma dessas decisões — nenhuma métrica é inventada.
 */

type ConsoleStep = { name: string; note: string };

type ConsoleInbound = { text: string; kind?: "text" | "audio" | "image" };

type ConsoleScenario = {
  id: string;
  /** Rótulo do separador — o visitante pode saltar para qualquer cenário. */
  label: string;
  /** O que este cenário prova, em texto de uma linha. */
  claim: string;
  /** Linha de sistema em vez de mensagem do cliente (usada no follow-up). */
  systemLine?: string;
  inbound: ConsoleInbound[];
  steps: ConsoleStep[];
  reply: string;
  replyKind?: "text" | "audio";
  attachment?: string;
  footer: string;
};

const SCENARIOS: ConsoleScenario[] = [
  {
    id: "agenda",
    label: "Agenda",
    claim: "Marca o compromisso sozinho",
    inbound: [{ text: "Oi! Vi o anúncio de vocês. Ainda dá pra marcar uma visita na terça?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Idioma", note: "pt-BR detectado" },
      { name: "Conhecimento", note: "3 trechos da base do agente" },
      { name: "Agenda", note: "terça, 14h — horário livre" },
      { name: "CRM", note: "lead movido para Em conversa" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Dá sim, Marina! Terça às 14h está livre — reservo pra você? Já te mando o endereço e um lembrete 1h antes.",
    footer: "Compromisso criado · lembrete agendado",
  },
  {
    id: "audio",
    label: "Áudio",
    claim: "Ouve o áudio e responde em voz",
    inbound: [
      { text: "áudio de voz · 0:14", kind: "audio" },
      { text: "e se der já me manda o valor" },
      { text: "obrigado!" },
    ],
    steps: [
      { name: "Rajada", note: "3 mensagens agrupadas em um turno" },
      { name: "Áudio", note: "transcrito antes de decidir" },
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conhecimento", note: "tabela de preços na base do agente" },
      { name: "Voz", note: "resposta gerada em áudio" },
      { name: "Entrega", note: "áudio enviado no WhatsApp" },
    ],
    reply:
      "Ouvi seu áudio, Rafael! Consigo sim fazer nessa condição. O valor fica em R$ 2.400 à vista ou em 3x sem juros — qual prefere?",
    replyKind: "audio",
    footer: "3 mensagens do cliente, 1 resposta só",
  },
  {
    id: "sistema",
    label: "Seu sistema",
    claim: "Consulta o seu sistema em tempo real",
    inbound: [{ text: "Vocês ainda têm apartamento de 2 quartos no Setor Bueno?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conector", note: "API do cliente, operação autorizada" },
      { name: "Consulta", note: "somente leitura, campos declarados" },
      { name: "Resultado", note: "3 unidades disponíveis" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Temos sim! Achei 3 unidades de 2 quartos no Setor Bueno, a partir de R$ 320.000. Quer que eu mande a ficha de cada uma?",
    footer: "Consulta ao sistema do cliente · nunca escreve nada",
  },
  {
    id: "arquivo",
    label: "Arquivos",
    claim: "Envia o material certo, na hora certa",
    inbound: [{ text: "Consegue me mandar a tabela de preços?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Catálogo", note: "arquivo autorizado localizado" },
      { name: "Verificação", note: "só envia o que o dono liberou" },
      { name: "Entrega", note: "texto + arquivo no WhatsApp" },
    ],
    reply: "Claro! Segue a tabela atualizada. Qualquer dúvida sobre as condições, me chama por aqui.",
    attachment: "tabela-precos-2026.pdf",
    footer: "Arquivo do catálogo do agente",
  },
  {
    id: "imagem",
    label: "Imagem",
    claim: "Lê o que o cliente manda na foto",
    inbound: [
      { text: "comprovante.jpg", kind: "image" },
      { text: "consegue confirmar se está certo?" },
    ],
    steps: [
      { name: "Rajada", note: "2 mensagens agrupadas em um turno" },
      { name: "Imagem", note: "analisada antes de decidir" },
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Conhecimento", note: "regras de pagamento na base" },
      { name: "Entrega", note: "resposta enviada no WhatsApp" },
    ],
    reply:
      "Recebi, Camila! O comprovante está no valor e no nome corretos. Já registrei aqui e te aviso assim que a equipe confirmar.",
    footer: "Imagem lida pelo agente",
  },
  {
    id: "humano",
    label: "Humano",
    claim: "Chama a pessoa certa na hora certa",
    inbound: [{ text: "Isso está bem acima do meu orçamento. Dá pra falar com um gerente?" }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Gatilho", note: "palavra-chave configurada: gerente" },
      { name: "Transferência", note: "conversa entregue ao responsável" },
      { name: "Aviso", note: "vendedor notificado no WhatsApp" },
      { name: "Automação", note: "pausada — ninguém fala por cima" },
    ],
    reply:
      "Claro! Já chamei o gerente responsável — ele continua com você por aqui mesmo, em instantes.",
    footer: "Automação pausada · humano no controle",
  },
  {
    id: "descarte",
    label: "Descarte",
    claim: "Sabe a hora de parar",
    inbound: [{ text: "Obrigado, mas eu só estava pesquisando. Não tenho interesse agora." }],
    steps: [
      { name: "Contexto", note: "histórico + memória do lead" },
      { name: "Critérios", note: "regras do negócio configuradas" },
      { name: "Desfecho", note: "sem interesse — com citação literal" },
      { name: "CRM", note: "card movido para Perdido" },
      { name: "Atendimento", note: "encerrado, sem follow-up" },
    ],
    reply: "Sem problema! Se mudar de ideia é só me chamar por aqui. Boa semana.",
    footer: "Único desfecho terminal — só com critérios definidos",
  },
  {
    id: "followup",
    label: "Follow-up",
    claim: "Volta sozinho quando o lead some",
    systemLine: "sem resposta do cliente desde ontem",
    inbound: [],
    steps: [
      { name: "Silêncio", note: "intervalo configurado no agente" },
      { name: "Memória", note: "retoma o assunto de onde parou" },
      { name: "Tentativa", note: "1 de 3 configuradas" },
      { name: "CRM", note: "card movido para Em follow-up" },
      { name: "Entrega", note: "mensagem enviada no WhatsApp" },
    ],
    reply:
      "Oi Marina! Passando só pra saber se a terça às 14h ainda funciona pra você. Se preferir outro dia, me diz que eu remarco.",
    footer: "Follow-up automático · sem ninguém apertar nada",
  },
];

/** Pausa entre o fim de uma demonstração e o início da próxima. */
const CONSOLE_HOLD_MS = 34_000;
const TYPE_MS = 22;
const STEP_MS = 320;

function InboundIcon({ kind }: { kind: ConsoleInbound["kind"] }) {
  if (kind === "audio") return <Mic size={13} style={{ color: "var(--live)" }} />;
  if (kind === "image") return <ImageIcon size={13} style={{ color: "var(--live)" }} />;
  return null;
}

function HeroConsole() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const [chars, setChars] = useState(0);
  const [steps, setSteps] = useState(0);
  const [replyOut, setReplyOut] = useState(false);

  const scenario = SCENARIOS[index]!;
  const inboundDone = msgIndex >= scenario.inbound.length;

  const goTo = useCallback((next: number) => {
    setIndex(((next % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length);
    setMsgIndex(0);
    setChars(0);
    setSteps(0);
    setReplyOut(false);
  }, []);

  // Sem movimento: mostra o estado final do cenário e não avança sozinho.
  useEffect(() => {
    if (!reduced) return;
    setMsgIndex(scenario.inbound.length);
    setChars(scenario.inbound[scenario.inbound.length - 1]?.text.length ?? 0);
    setSteps(scenario.steps.length);
    setReplyOut(true);
  }, [reduced, scenario]);

  // 1. Escreve as mensagens do cliente, uma a uma.
  useEffect(() => {
    if (reduced || inboundDone) return;
    const full = scenario.inbound[msgIndex]!.text;
    if (chars >= full.length) {
      const t = setTimeout(() => {
        setMsgIndex((v) => v + 1);
        setChars(0);
      }, 320);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setChars((v) => v + 1), TYPE_MS);
    return () => clearTimeout(t);
  }, [reduced, inboundDone, scenario, msgIndex, chars]);

  // 2. Acende os passos do raciocínio.
  useEffect(() => {
    if (reduced || !inboundDone || steps >= scenario.steps.length) return;
    const t = setTimeout(() => setSteps((v) => v + 1), steps === 0 ? 420 : STEP_MS);
    return () => clearTimeout(t);
  }, [reduced, inboundDone, steps, scenario]);

  // 3. Mostra a resposta.
  useEffect(() => {
    if (reduced || replyOut || !inboundDone || steps < scenario.steps.length) return;
    const t = setTimeout(() => setReplyOut(true), 420);
    return () => clearTimeout(t);
  }, [reduced, replyOut, inboundDone, steps, scenario]);

  // 4. Segura 30s antes de passar ao cenário seguinte.
  useEffect(() => {
    if (reduced || !replyOut) return;
    const t = setTimeout(() => goTo(index + 1), CONSOLE_HOLD_MS);
    return () => clearTimeout(t);
  }, [reduced, replyOut, index, goTo]);

  return (
    <div className="mcx-console">
      <div className="mcx-console-bar">
        <span className="mcx-dot" />
        <span className="mcx-mono" style={{ letterSpacing: ".16em" }}>
          Agente ao vivo
        </span>
        <span style={{ flex: 1 }} />
        <span className="mcx-mono mcx-console-provider" style={{ fontSize: 10 }}>
          WhatsApp · API Oficial
        </span>
      </div>

      <div className="mcx-console-tabs" role="tablist" aria-label="Demonstrações do agente">
        {SCENARIOS.map((item, i) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={i === index ? "mcx-tab on" : "mcx-tab"}
            onClick={() => goTo(i)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mcx-console-claim">
        <Sparkles size={12} style={{ color: "var(--brand-hi)", flexShrink: 0 }} />
        <span>{scenario.claim}</span>
      </div>

      <div className="mcx-console-thread">
        {scenario.systemLine ? (
          <div className="mcx-console-system">
            <i />
            <span>{scenario.systemLine}</span>
            <i />
          </div>
        ) : null}

        {scenario.inbound.map((message, i) => {
          if (i > msgIndex) return null;
          const typing = i === msgIndex && !inboundDone;
          const text = typing ? message.text.slice(0, chars) : message.text;
          const media = message.kind && message.kind !== "text";
          return (
            <div key={`${scenario.id}-${i}`} className="mcx-bubble mcx-bubble-in">
              {media ? (
                <span className="mcx-bubble-media">
                  <InboundIcon kind={message.kind} />
                  <span>{text}</span>
                </span>
              ) : (
                <span>{text}</span>
              )}
              {typing ? <i className="mcx-caret" /> : null}
            </div>
          );
        })}
      </div>

      <div className="mcx-console-trace">
        {scenario.steps.map((step, i) => {
          const on = i < steps;
          return (
            <div key={`${scenario.id}-${step.name}`} className={on ? "mcx-trace on" : "mcx-trace"}>
              <span className="mcx-trace-idx">{String(i + 1).padStart(2, "0")}</span>
              <span>
                <span className="mcx-trace-name">{step.name}</span>
                <span className="mcx-trace-note" style={{ display: "block", marginTop: 2 }}>
                  {on ? step.note : "—"}
                </span>
              </span>
              <motion.span
                initial={false}
                animate={{ opacity: on ? 1 : 0.18, scale: on ? 1 : 0.8 }}
                transition={{ duration: 0.24 }}
                style={{ color: on ? "var(--live)" : "var(--faint)", display: "flex" }}
              >
                <Check size={13} strokeWidth={3} />
              </motion.span>
            </div>
          );
        })}
      </div>

      <div className="mcx-console-reply">
        <AnimatePresence mode="wait">
          {replyOut ? (
            <motion.div
              key={`${scenario.id}-reply`}
              initial={reduced ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              style={{ display: "flex", flexDirection: "column", gap: 8 }}
            >
              <div className="mcx-bubble mcx-bubble-out">
                {scenario.replyKind === "audio" ? (
                  <span className="mcx-bubble-media" style={{ marginBottom: 6 }}>
                    <Mic size={13} />
                    <span>resposta em áudio</span>
                  </span>
                ) : null}
                {scenario.reply}
              </div>
              {scenario.attachment ? (
                <div className="mcx-attach">
                  <Paperclip size={13} />
                  <span>{scenario.attachment}</span>
                </div>
              ) : null}
              <div
                className="mcx-mono"
                style={{ textAlign: "right", fontSize: 10, letterSpacing: ".13em" }}
              >
                {scenario.footer}
              </div>
              {reduced ? null : (
                <div className="mcx-hold" aria-hidden="true">
                  <i key={scenario.id} style={{ animationDuration: `${CONSOLE_HOLD_MS}ms` }} />
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key={`${scenario.id}-thinking`}
              initial={false}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="mcx-mono"
              style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 6 }}
            >
              <Cpu size={13} style={{ color: "var(--brand)" }} />
              a decidir o próximo passo…
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

const TRUST = [
  "API Oficial da Meta",
  "Responde a áudio e imagem",
  "2 linhas WhatsApp por conta",
  "CRM, agenda e follow-up juntos",
] as const;

function Hero() {
  const onHash = useHashNav();
  const reduced = useReducedMotion();

  return (
    <header style={{ position: "relative", overflow: "hidden" }}>
      <div className="mcx-grid" />
      <div
        className="mcx-aurora"
        style={{
          width: 620,
          height: 620,
          top: -260,
          left: "-8%",
          background: "rgba(242,68,0,.22)",
          animation: reduced ? undefined : "mcx-float 22s ease-in-out infinite alternate",
        }}
      />
      <div
        className="mcx-aurora"
        style={{
          width: 560,
          height: 560,
          top: -180,
          right: "-10%",
          background: "rgba(30,74,110,.34)",
        }}
      />

      <div
        className="mcx-shell mcx-hero"
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gap: "clamp(38px,5vw,62px)",
          padding: "clamp(56px,8vw,104px) 24px clamp(48px,6vw,80px)",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 26, maxWidth: 660 }}>
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="mcx-chip">
              <span className="mcx-dot" />
              O comercial que não dorme
            </span>
          </motion.div>

          <motion.h1
            className="mcx-h1"
            initial={reduced ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            Seu WhatsApp responde,
            <br />
            qualifica e agenda
            <br />
            <span className="mcx-accent">sozinho.</span>
          </motion.h1>

          <motion.p
            className="mcx-lead"
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            O MyChatCRM lê a conversa inteira, decide o que fazer a cada mensagem, marca o
            compromisso na agenda, move o lead no CRM Kanban e passa para um humano na hora certa —
            tudo pela API Oficial da Meta.
          </motion.p>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
          >
            <Link href="/planos" className="mcx-btn mcx-btn-primary mcx-btn-lg">
              Ativar meu agente
              <ArrowRight size={17} />
            </Link>
            <Link
              href="#motor"
              onClick={(e) => onHash(e, "#motor")}
              className="mcx-btn mcx-btn-ghost mcx-btn-lg"
            >
              Ver como ele decide
            </Link>
          </motion.div>

          <motion.ul
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
              gap: "9px 22px",
            }}
          >
            {TRUST.map((t) => (
              <li
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontSize: ".875rem",
                  color: "var(--muted)",
                }}
              >
                <Check size={14} strokeWidth={3} style={{ color: "var(--live)", flexShrink: 0 }} />
                {t}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div
          initial={reduced ? false : { opacity: 0, y: 28, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <HeroConsole />
        </motion.div>
      </div>
    </header>
  );
}

const TICKER_ITEMS = [
  ["Agentes de IA", "conforme o plano"],
  ["CRM Kanban", "funis e etapas próprias"],
  ["Agenda Google", "sincronizada"],
  ["Follow-up", "automático e com memória"],
  ["Disparos em massa", "com janela de horário"],
  ["Transferência", "para humano na hora certa"],
  ["APIs externas", "REST/JSON com OAuth2"],
  ["Equipas", "diretor, gerente e vendedor"],
] as const;

function Ticker() {
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="mcx-ticker" aria-hidden="true">
      <div className="mcx-ticker-row">
        {row.map(([a, b], i) => (
          <span className="mcx-ticker-item" key={`${a}-${i}`}>
            <b>{a}</b>
            {b}
            <span style={{ color: "var(--line-strong)", marginLeft: 16 }}>/</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motor — como o agente decide
// ---------------------------------------------------------------------------

const ENGINE = [
  {
    icon: MessageSquare,
    title: "Junta a rajada",
    body: "O cliente manda cinco mensagens seguidas? O agente espera terminar e responde uma vez só, no contexto de todas — não cinco respostas soltas.",
  },
  {
    icon: Fingerprint,
    title: "Lê quem é o lead",
    body: "Histórico da conversa, memória do contacto, origem (anúncio, formulário Meta, contacto espontâneo) e a base de conhecimento daquele agente.",
  },
  {
    icon: Calendar,
    title: "Marca de verdade",
    body: "Confere o horário no fuso certo, valida a data proposta e cria o compromisso na agenda. Se o horário não existe, ele não inventa.",
  },
  {
    icon: Columns3,
    title: "Move o lead no CRM",
    body: "Quando o cliente responde, o cartão anda de coluna sozinho no funil que você configurou. Sem ninguém arrastar nada à mão.",
  },
  {
    icon: Users,
    title: "Chama o humano",
    body: "Pedido de desconto, reclamação, palavra-chave que você definiu — a conversa passa para a pessoa certa e a automação pausa.",
  },
  {
    icon: RefreshCw,
    title: "Não deixa esfriar",
    body: "Se o cliente some, o follow-up volta sozinho no intervalo que você escolheu, lembrando do que já tinha sido conversado.",
  },
] as const;

function Engine() {
  return (
    <section id="motor" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>O motor</SectionLabel>
          <h2 className="mcx-h2">
            Cada mensagem passa por um raciocínio.
            <br />
            <span style={{ color: "var(--muted)" }}>Não por um roteiro fixo.</span>
          </h2>
          <p className="mcx-lead" style={{ marginTop: 18 }}>
            A maioria dos chatbots segue uma árvore de botões. Aqui, o agente decide o que fazer a
            cada mensagem — e o que ele decidiu fica registado, passo a passo.
          </p>
        </Reveal>

        <div className="mcx-pipe" style={{ marginTop: 44 }}>
          {ENGINE.map((node, i) => {
            const Icon = node.icon;
            return (
              <Reveal key={node.title} delay={i * 0.06}>
                <article className="mcx-card mcx-node" style={{ height: "100%" }}>
                  <div className="mcx-node-top">
                    <span className="mcx-node-idx">{String(i + 1).padStart(2, "0")}</span>
                    <span className="mcx-node-ico">
                      <Icon size={16} />
                    </span>
                  </div>
                  <h3 className="mcx-h3">{node.title}</h3>
                  <p className="mcx-body">{node.body}</p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recursos — bento
// ---------------------------------------------------------------------------

function KanbanMini() {
  return (
    <div className="mcx-kan">
      {[
        { h: "Novo", cards: [0, 0] },
        { h: "Em conversa", cards: [1, 0, 0] },
        { h: "Proposta", cards: [1] },
      ].map((col) => (
        <div className="mcx-kan-col" key={col.h}>
          <div className="mcx-kan-h">{col.h}</div>
          {col.cards.map((hot, i) => (
            <div key={i} className={hot ? "mcx-kan-card hot" : "mcx-kan-card"} />
          ))}
        </div>
      ))}
    </div>
  );
}

function BarsMini() {
  const heights = [34, 52, 41, 68, 58, 82, 74];
  return (
    <div className="mcx-bars">
      {heights.map((h, i) => (
        <div
          key={i}
          className={i >= 4 ? "mcx-bar on" : "mcx-bar"}
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function SlotsMini() {
  return (
    <div className="mcx-slots">
      {[
        ["Terça · 14:00", "reservado", true],
        ["Terça · 16:30", "livre", false],
        ["Quarta · 09:00", "livre", false],
      ].map(([when, state, taken]) => (
        <div key={String(when)} className={taken ? "mcx-slot taken" : "mcx-slot"}>
          <span>{when}</span>
          <span>{state}</span>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    size: "lg" as const,
    icon: Columns3,
    title: "CRM Kanban que se move sozinho",
    body: "Funis e colunas do seu jeito. O agente move o cartão quando o lead responde, e o vendedor só vê os leads que são dele.",
    visual: <KanbanMini />,
  },
  {
    size: "md" as const,
    icon: Calendar,
    title: "Agenda com horário real",
    body: "Confere disponibilidade, cria o compromisso e manda o lembrete antes.",
    visual: <SlotsMini />,
  },
  {
    size: "md" as const,
    icon: Gauge,
    title: "Relatório do que importa",
    body: "Leads, conversas, tempo de primeira resposta e desempenho por vendedor.",
    visual: <BarsMini />,
  },
  {
    size: "md" as const,
    icon: Mic,
    title: "Áudio, imagem e documento",
    body: "O cliente manda áudio, o agente entende. E responde em voz, se você quiser.",
    visual: null,
  },
  {
    size: "md" as const,
    icon: Users,
    title: "Equipa com hierarquia",
    body: "Diretor, gerente e vendedor. Cada um vê exatamente o que pode ver — a barreira é aplicada no servidor, não no ecrã.",
    visual: null,
  },
  {
    size: "full" as const,
    icon: Plug,
    title: "Conecta ao resto do seu negócio",
    body: "Formulários do Meta, disparos em massa com janela de horário, Google Agenda e conectores REST/JSON com OAuth2 para consultar o seu próprio sistema.",
    visual: null,
  },
] as const;

function Features() {
  return (
    <section id="recursos" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>Dentro do produto</SectionLabel>
          <h2 className="mcx-h2">Um painel só, do primeiro “oi” ao fechamento.</h2>
        </Reveal>

        <div className="mcx-bento" style={{ marginTop: 40 }}>
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal
                key={f.title}
                delay={i * 0.05}
                className={`mcx-b-${f.size}`}
              >
                <article className="mcx-card mcx-tile" style={{ height: "100%" }}>
                  <span className="mcx-tile-ico">
                    <Icon size={17} />
                  </span>
                  <h3 className="mcx-h3">{f.title}</h3>
                  <p className="mcx-body">{f.body}</p>
                  {f.visual}
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Calculadora — os números são do próprio visitante, não nossos
// ---------------------------------------------------------------------------

function Field({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const id = `mcx-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="mcx-field">
      <div className="mcx-field-top">
        <label className="mcx-field-lbl" htmlFor={id}>
          {label}
        </label>
        <span className="mcx-field-val">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Calculator() {
  const [leads, setLeads] = useState(600);
  const [ticket, setTicket] = useState(2500);
  const [close, setClose] = useState(12);
  const [missed, setMissed] = useState(40);

  const { lost, recovered, plan } = useMemo(() => {
    const semResposta = (leads * missed) / 100;
    const fechados = (semResposta * close) / 100;
    const lostValue = fechados * ticket;
    // Cenário conservador: metade do que hoje fica sem resposta rápida passa a ser atendido.
    return { lost: lostValue, recovered: lostValue * 0.5, plan: 997 };
  }, [leads, ticket, close, missed]);

  return (
    <section id="calculadora" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>A conta</SectionLabel>
          <h2 className="mcx-h2">Quanto vale o lead que ninguém respondeu?</h2>
          <p className="mcx-lead" style={{ marginTop: 18 }}>
            Mexa nos controlos com os números reais da sua operação. A estimativa é sua — usamos
            apenas o que você informar, sem promessa de resultado.
          </p>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="mcx-calc" style={{ marginTop: 40 }}>
            <div className="mcx-panel" style={{ padding: "10px 26px 20px" }}>
              <Field
                label="Leads que chegam por mês"
                value={leads}
                min={50}
                max={5000}
                step={50}
                onChange={setLeads}
                format={(v) => NUM.format(v)}
              />
              <Field
                label="Ticket médio de uma venda"
                value={ticket}
                min={200}
                max={30000}
                step={100}
                onChange={setTicket}
                format={(v) => BRL.format(v)}
              />
              <Field
                label="Taxa de fechamento da equipa"
                value={close}
                min={1}
                max={40}
                step={1}
                onChange={setClose}
                format={(v) => `${v}%`}
              />
              <Field
                label="Leads sem resposta rápida hoje"
                value={missed}
                min={5}
                max={90}
                step={5}
                onChange={setMissed}
                format={(v) => `${v}%`}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="mcx-card mcx-readout">
                <span className="mcx-mono">Parado todo mês</span>
                <span className="mcx-readout-big">{BRL.format(lost)}</span>
                <p className="mcx-body" style={{ color: "var(--muted)" }}>
                  É o valor dos negócios que hoje entram e ficam sem resposta rápida —{" "}
                  {NUM.format(Math.round((leads * missed) / 100))} leads por mês.
                </p>
              </div>

              <div className="mcx-readout-split">
                <div className="mcx-readout-cell">
                  <span className="mcx-mono">Recuperando metade</span>
                  <span
                    className="mcx-num"
                    style={{
                      fontFamily: "var(--f-display)",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                      letterSpacing: "-.03em",
                      color: "var(--live)",
                    }}
                  >
                    {BRL.format(recovered)}
                  </span>
                </div>
                <div className="mcx-readout-cell">
                  <span className="mcx-mono">Plano Escala</span>
                  <span
                    className="mcx-num"
                    style={{
                      fontFamily: "var(--f-display)",
                      fontWeight: 700,
                      fontSize: "1.5rem",
                      letterSpacing: "-.03em",
                    }}
                  >
                    {priceBRL(plan)}/mês
                  </span>
                </div>
              </div>

              <Link
                href="/planos"
                className="mcx-btn mcx-btn-primary mcx-btn-lg"
                style={{ width: "100%" }}
              >
                Quero parar de perder esses leads
                <ArrowRight size={17} />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

type Cycle = "monthly" | "annual";

const CHECKOUT_PLANS = SALES_PLANS.filter((p) => !p.contactOnly && p.priceMonthly !== null);
const ENTERPRISE = SALES_PLANS.find((p) => p.contactOnly);

function Pricing() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const whatsapp = whatsappHandoffHref();

  return (
    <section id="planos" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell">
        <Reveal>
          <SectionLabel>Planos</SectionLabel>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 22,
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2 className="mcx-h2">Preço em reais, sem letra miúda.</h2>
              <p className="mcx-lead" style={{ marginTop: 16 }}>
                Todos os planos trazem o produto inteiro — o que muda são os limites. Duas linhas de
                WhatsApp incluídas em qualquer um.
              </p>
            </div>
            <div className="mcx-toggle" role="group" aria-label="Ciclo de cobrança">
              <button
                type="button"
                className={cycle === "monthly" ? "on" : ""}
                onClick={() => setCycle("monthly")}
                aria-pressed={cycle === "monthly"}
              >
                Mensal
              </button>
              <button
                type="button"
                className={cycle === "annual" ? "on" : ""}
                onClick={() => setCycle("annual")}
                aria-pressed={cycle === "annual"}
              >
                Anual −{PLAN_ANNUAL_DISCOUNT_PERCENT}%
              </button>
            </div>
          </div>
        </Reveal>

        <div className="mcx-plans" style={{ marginTop: 40 }}>
          {CHECKOUT_PLANS.map((plan, i) => {
            const popular = plan.accent === "popular";
            const monthly = planEffectiveMonthlyBRL(plan.priceMonthly as number, cycle);
            const href = `/checkout/${plan.slug}${cycle === "annual" ? "?ciclo=anual" : ""}`;
            const bullets = plan.features.slice(1, 5);

            return (
              <Reveal key={plan.slug} delay={i * 0.06}>
                <article
                  className={popular ? "mcx-card mcx-plan mcx-plan-pop" : "mcx-card mcx-plan"}
                  style={{ height: "100%" }}
                >
                  {popular ? <span className="mcx-plan-badge">{plan.badge}</span> : null}
                  <div>
                    <h3
                      className="mcx-h3"
                      style={{ fontSize: "1.22rem", marginBottom: 6 }}
                    >
                      {plan.name}
                    </h3>
                    <p className="mcx-body" style={{ fontSize: ".85rem", minHeight: 42 }}>
                      {plan.tagline}
                    </p>
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                      <span className="mcx-price">{priceBRL(monthly)}</span>
                      <span className="mcx-mono" style={{ letterSpacing: ".1em" }}>
                        /mês
                      </span>
                    </div>
                    <p className="mcx-mono" style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}>
                      {cycle === "annual"
                        ? `Cobrado anualmente · ${priceBRL(monthly * 12)}/ano`
                        : "Cobrado mensalmente"}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "12px 14px",
                      borderRadius: 11,
                      border: "1px solid var(--line)",
                      background: "rgba(255,255,255,.025)",
                    }}
                  >
                    <div className="mcx-mono" style={{ marginBottom: 5 }}>
                      Incluído
                    </div>
                    <div style={{ fontSize: ".85rem", color: "var(--text)" }}>
                      {plan.monthlyLeadsLabel}
                    </div>
                    <div style={{ fontSize: ".78rem", color: "var(--faint)", marginTop: 3 }}>
                      2 números WhatsApp (API oficial)
                    </div>
                  </div>

                  <ul className="mcx-plan-list">
                    {bullets.map((b) => (
                      <li key={b}>
                        <Check size={13} strokeWidth={3} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mcx-plan-foot">
                    <Link
                      href={href}
                      className={`mcx-btn ${popular ? "mcx-btn-primary" : "mcx-btn-ghost"}`}
                      style={{ width: "100%" }}
                    >
                      Assinar {plan.name}
                    </Link>
                  </div>
                </article>
              </Reveal>
            );
          })}

          {ENTERPRISE ? (
            <Reveal delay={0.24}>
              <article
                className="mcx-card mcx-plan"
                style={{
                  height: "100%",
                  background: "linear-gradient(180deg,rgba(14,29,41,.85),rgba(255,255,255,.012))",
                }}
              >
                <div>
                  <h3 className="mcx-h3" style={{ fontSize: "1.22rem", marginBottom: 6 }}>
                    {ENTERPRISE.name}
                  </h3>
                  <p className="mcx-body" style={{ fontSize: ".85rem", minHeight: 42 }}>
                    {ENTERPRISE.tagline}
                  </p>
                </div>
                <div>
                  <span className="mcx-price" style={{ fontSize: "1.9rem" }}>
                    Sob consulta
                  </span>
                  <p className="mcx-mono" style={{ marginTop: 7, textTransform: "none", letterSpacing: ".04em" }}>
                    Pacote e limites definidos com o comercial
                  </p>
                </div>
                <ul className="mcx-plan-list">
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Volume de leads e agentes à medida</span>
                  </li>
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Onboarding e acompanhamento dedicados</span>
                  </li>
                  <li>
                    <Check size={13} strokeWidth={3} />
                    <span>Contrato e faturação sob medida</span>
                  </li>
                </ul>
                <div className="mcx-plan-foot">
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mcx-btn mcx-btn-ghost"
                    style={{ width: "100%" }}
                  >
                    Falar com o comercial
                  </a>
                </div>
              </article>
            </Reveal>
          ) : null}
        </div>

        <Reveal delay={0.3}>
          <p
            className="mcx-mono"
            style={{ marginTop: 26, textTransform: "none", letterSpacing: ".03em", lineHeight: 1.7 }}
          >
            7 dias para pedir reembolso nos planos com checkout online · Número extra de WhatsApp:
            R$ 75/mês · Conector de API adicional: R$ 49,90/mês ·{" "}
            <Link href="/planos" style={{ color: "var(--brand-hi)" }}>
              ver comparativo completo
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const FAQ = [
  {
    q: "Isto usa a API oficial do WhatsApp?",
    a: "Sim. Trabalhamos com a API Oficial da Meta (WhatsApp Business) — entregabilidade, segurança e conformidade com as regras da plataforma. Também há a opção de ligar por QR code quando faz sentido para o seu caso.",
  },
  {
    q: "Quantos números de WhatsApp posso ligar?",
    a: "Todos os planos incluem duas linhas: uma para os leads que vêm de formulários do Meta e outra para o WhatsApp direto. Cada número adicional custa R$ 75/mês.",
  },
  {
    q: "O agente responde a áudio?",
    a: "Responde. Ele transcreve o áudio do cliente, entende o pedido e pode responder por texto ou por voz, com a voz que você escolher para aquele agente.",
  },
  {
    q: "E quando a conversa precisa de uma pessoa?",
    a: "Você define os gatilhos — pedido de desconto, reclamação, palavras específicas. Nesse momento a automação pausa, a conversa vai para o responsável certo e ninguém fica a falar por cima do agente.",
  },
  {
    q: "Preciso de alguém técnico para configurar?",
    a: "Não. Os agentes são criados por um assistente passo a passo no painel, e o CRM, a agenda e os funis já vêm prontos para usar. Integrações mais avançadas ficam disponíveis quando você precisar.",
  },
  {
    q: "O vendedor consegue ver os leads dos colegas?",
    a: "Não. O recorte por equipa é aplicado no servidor, na própria consulta: o vendedor só recebe os leads atribuídos a ele, o gerente vê a equipa dele e o diretor vê as equipas em que está.",
  },
  {
    q: "Posso cancelar quando quiser?",
    a: "Pode. Os planos são mensais (ou anuais, com desconto) e o cancelamento é feito conforme os termos, sem multa escondida. Nos planos com checkout online (Solo, Equipa e Escala) ainda tem 7 dias para pedir reembolso se não ficar satisfeito.",
  },
] as const;

function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" style={{ padding: "clamp(64px,8vw,110px) 0", scrollMarginTop: 76 }}>
      <div className="mcx-shell" style={{ maxWidth: 900 }}>
        <Reveal>
          <SectionLabel>Dúvidas</SectionLabel>
          <h2 className="mcx-h2">O que costumam perguntar antes de assinar.</h2>
        </Reveal>

        <div style={{ marginTop: 34 }}>
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <Reveal key={item.q} delay={i * 0.04}>
                <div className="mcx-faq-item">
                  <button
                    type="button"
                    className="mcx-faq-q"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    {item.q}
                    <ChevronDown size={18} className="mcx-faq-ico" />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        className="mcx-faq-a"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <p className="mcx-body">{item.a}</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CTA final
// ---------------------------------------------------------------------------

function FinalCta() {
  const whatsapp = whatsappHandoffHref();
  return (
    <section style={{ padding: "clamp(30px,5vw,60px) 0 clamp(70px,8vw,110px)" }}>
      <div className="mcx-shell">
        <Reveal>
          <div className="mcx-final">
            <div
              className="mcx-aurora"
              style={{
                width: 480,
                height: 480,
                bottom: -300,
                left: "50%",
                transform: "translateX(-50%)",
                background: "rgba(242,68,0,.3)",
              }}
            />
            <div style={{ position: "relative", zIndex: 1 }}>
              <span className="mcx-chip" style={{ marginBottom: 22 }}>
                <Sparkles size={12} style={{ color: "var(--brand-hi)" }} />
                Ative hoje
              </span>
              <h2 className="mcx-h2" style={{ maxWidth: 720, margin: "0 auto" }}>
                Enquanto você lê isto, alguém está a mandar mensagem para a sua empresa.
              </h2>
              <p className="mcx-lead" style={{ margin: "20px auto 0", textAlign: "center" }}>
                Ligue o WhatsApp, crie o seu agente e deixe o comercial a trabalhar — inclusive às
                três da manhã.
              </p>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  justifyContent: "center",
                  marginTop: 30,
                }}
              >
                <Link href="/planos" className="mcx-btn mcx-btn-primary mcx-btn-lg">
                  Escolher o meu plano
                  <ArrowRight size={17} />
                </Link>
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mcx-btn mcx-btn-ghost mcx-btn-lg"
                >
                  Falar no WhatsApp
                </a>
              </div>
              <p className="mcx-mono" style={{ marginTop: 20, textTransform: "none", letterSpacing: ".04em" }}>
                Sem instalação. 7 dias para pedir reembolso nos planos com checkout online.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Rodapé
// ---------------------------------------------------------------------------

type Social = "instagram" | "tiktok" | "youtube" | "x" | "linkedin";

const SOCIALS: { key: Social; href: string; label: string }[] = [
  { key: "instagram", href: SOCIAL_LINKS.instagram, label: "Instagram" },
  { key: "tiktok", href: SOCIAL_LINKS.tiktok, label: "TikTok" },
  { key: "youtube", href: SOCIAL_LINKS.youtube, label: "YouTube" },
  { key: "x", href: SOCIAL_LINKS.x, label: "X" },
  { key: "linkedin", href: SOCIAL_LINKS.linkedin, label: "LinkedIn" },
];

function SocialIcon({ kind }: { kind: Social }) {
  const p = { width: 16, height: 16, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  if (kind === "instagram") {
    return (
      <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "youtube") {
    return (
      <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
        <path d="M10.2 9.6l4.6 2.4-4.6 2.4V9.6z" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (kind === "linkedin") {
    return (
      <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M7.4 10.4v6.2M7.4 7.6v.1M11.4 16.6v-6.2M11.4 13c0-1.5 1-2.6 2.4-2.6s2.3 1 2.3 2.6v3.6" />
      </svg>
    );
  }
  if (kind === "x") {
    return (
      <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 4l16 16M20 4L4 20" />
      </svg>
    );
  }
  return (
    <svg {...p} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 3.5v10.9a4 4 0 11-3.2-3.9" />
      <path d="M14 3.5c.5 2.2 2 3.6 4.3 3.8" />
    </svg>
  );
}

function Footer() {
  const onHash = useHashNav();
  const year = new Date().getFullYear();
  const whatsapp = whatsappHandoffHref();

  return (
    <footer className="mcx-foot">
      <div className="mcx-shell">
        <div className="mcx-foot-grid">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <LogoMark size={28} />
              <span className="mcx-wordmark">MyChatCRM</span>
            </div>
            <p className="mcx-body" style={{ maxWidth: "34ch", fontSize: ".875rem" }}>
              CRM com agentes de IA que atendem, qualificam e agendam no WhatsApp — pela API Oficial
              da Meta.
            </p>
            <div className="mcx-social" style={{ marginTop: 18 }}>
              {SOCIALS.map((s) => (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                >
                  <SocialIcon kind={s.key} />
                </a>
              ))}
            </div>
          </div>

          <div>
            <h4>Produto</h4>
            <ul>
              <li>
                <Link href="#motor" onClick={(e) => onHash(e, "#motor")}>
                  Como o agente decide
                </Link>
              </li>
              <li>
                <Link href="#recursos" onClick={(e) => onHash(e, "#recursos")}>
                  Recursos
                </Link>
              </li>
              <li>
                <Link href="#calculadora" onClick={(e) => onHash(e, "#calculadora")}>
                  Calculadora
                </Link>
              </li>
              <li>
                <Link href="/planos">Planos e comparativo</Link>
              </li>
            </ul>
          </div>

          <div>
            <h4>Empresa</h4>
            <ul>
              <li>
                <Link href="/blog">Blog</Link>
              </li>
              <li>
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">
                  Falar no WhatsApp
                </a>
              </li>
              <li>
                <a href="mailto:comercial@mychatcrm.com.br">comercial@mychatcrm.com.br</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Conta e legal</h4>
            <ul>
              <li>
                <Link href="/login">Entrar</Link>
              </li>
              <li>
                <Link href="/termos-de-uso">Termos de uso</Link>
              </li>
              <li>
                <Link href="/politica-de-privacidade">Política de privacidade</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mcx-foot-bar">
          <span className="mcx-mono" style={{ textTransform: "none", letterSpacing: ".04em" }}>
            © {year} MyChatCRM. Todos os direitos reservados.
          </span>
          <span className="mcx-mono" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ShieldCheck size={13} style={{ color: "var(--live)" }} />
            WhatsApp Business API Oficial
          </span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Barra fixa (mobile) — só aparece depois do hero
// ---------------------------------------------------------------------------

function StickyBar() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 620);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="mcx-sticky"
          initial={{ y: 90 }}
          animate={{ y: 0 }}
          exit={{ y: 90 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          <a
            href={whatsappHandoffHref()}
            target="_blank"
            rel="noopener noreferrer"
            className="mcx-btn mcx-btn-ghost"
          >
            WhatsApp
          </a>
          <Link href="/planos" className="mcx-btn mcx-btn-primary">
            Ativar meu agente
          </Link>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export function LandingV2() {
  // Chegar na home já com âncora na URL (ex.: "/#recursos" vindo do /blog):
  // não há clique para interceptar, só o carregamento.
  useEffect(() => {
    if (!window.location.hash) return;
    const el = document.querySelector(window.location.hash);
    if (!el) return;
    const id = requestAnimationFrame(() => el.scrollIntoView({ behavior: "auto", block: "start" }));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="mcx">
      <style dangerouslySetInnerHTML={{ __html: SHEET }} />
      <Nav />
      <main>
        <Hero />
        <Ticker />
        <Engine />
        <Features />
        <Calculator />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <StickyBar />
    </div>
  );
}
