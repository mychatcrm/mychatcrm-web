"use client";

/**
 * Sistema de design das páginas públicas — "sala de controle".
 *
 * Fonte única do tema escuro usado na home, em /planos, no checkout e nos
 * ecrãs de entrada (cliente e admin). Vive numa folha escopada em `.mcx` com
 * especificidade de duas classes porque `.brand-marketing` (app/globals.css)
 * força Inter, tamanhos fixos de h1/h2/h3 e `box-shadow: none !important` em
 * todas as páginas sob `app/[locale]`. Mexer no global partiria o blog e as
 * páginas legais; aqui ganhamos a cascata sem tocar em nada de fora.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X as CloseIcon, ShieldCheck } from "lucide-react";
import { SOCIAL_LINKS } from "@/lib/social-links";
import { whatsappHandoffHref } from "@/lib/whatsapp-handoff";

export const MCX_SHEET = `
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
  --crit-line:rgba(232,128,121,.55);
  --line-soft:rgba(255,255,255,.05);

  /* Ponte para as classes Tailwind ja existentes. Dentro do escopo .mcx os tokens de
     superficie, linha e texto passam a apontar para a paleta escura, o que faz
     os componentes partilhados (Input, Button, Badge) e qualquer marcação
     legada ficarem coerentes sem serem reescritos — importante no checkout,
     onde a lógica de pagamento não deve ser mexida só por causa de cores. */
  --color-surface-base:5 8 11;
  --color-surface-deep:12 19 27;
  --color-surface-sidebar:8 14 20;
  --color-surface-card:12 19 27;
  --color-surface-elevated:17 27 37;
  --color-surface-brown:12 19 27;
  --color-line:38 48 57;
  --color-content:237 243 248;
  --color-content-secondary:237 243 248;
  --color-content-muted:148 165 180;
  --color-content-faint:95 114 132;
  /* mesma ponte para os tokens mc-* (DsInput, DsButton) usados nos ecras de entrada */
  --bg:#05080B;
  --border:#2A3642;
  --rail:#0C131B;
  --rail-muted:#5F7284;

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
/* Segunda linha da manchete: laranja, não itálico — igual à página inicial. */
.mcx .mcx-h1 em, .mcx .mcx-h2 em{ font-style:normal; color:var(--brand-hi); }
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
  display:grid; grid-template-columns:22px 1fr auto; gap:11px; align-items:center;
  padding:7px 16px; border-bottom:1px solid rgba(255,255,255,.05);
  font-family:var(--f-mono); font-size:11.5px;
}
.mcx .mcx-trace-body{
  display:flex; align-items:baseline; gap:9px; min-width:0;
}
.mcx .mcx-trace:last-child{ border-bottom:0; }
.mcx .mcx-trace-idx{ color:var(--faint); }
.mcx .mcx-trace-name{
  color:var(--muted); letter-spacing:.08em; text-transform:uppercase; font-size:10px;
  flex:0 0 auto; min-width:92px;
}
.mcx .mcx-trace-note{
  color:var(--faint); font-size:10.5px; min-width:0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.mcx .mcx-trace.on .mcx-trace-name{ color:var(--text); }
.mcx .mcx-trace.on .mcx-trace-idx{ color:var(--brand); }
.mcx .mcx-bubble{
  border-radius:14px; padding:10px 13px; font-size:.885rem; line-height:1.48;
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
  display:grid; grid-template-columns:repeat(auto-fit,minmax(100px,1fr));
  gap:6px; padding:11px 13px;
  border-bottom:1px solid var(--line); background:rgba(255,255,255,.015);
}
.mcx .mcx-tab{
  cursor:pointer; white-space:nowrap; text-align:center;
  overflow:hidden; text-overflow:ellipsis;
  border:1px solid var(--line); background:transparent; color:var(--faint);
  border-radius:999px; padding:5px 11px;
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.1em; text-transform:uppercase;
  transition:color .16s ease,border-color .16s ease,background .16s ease;
}
.mcx .mcx-tab:hover{ color:var(--muted); border-color:var(--line-strong); }
.mcx .mcx-tab.on{
  color:var(--brand-hi); border-color:rgba(242,68,0,.45); background:var(--brand-dim);
}
/* no telemóvel 8 separadores em 2 colunas dariam 4 linhas — força 3 colunas */
@media (max-width:520px){
  .mcx .mcx-console-tabs{ grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; padding:10px; }
  .mcx .mcx-tab{ padding:5px 6px; font-size:9px; letter-spacing:.06em; }
}
.mcx .mcx-console-claim{
  display:flex; align-items:center; gap:8px;
  padding:11px 16px; border-bottom:1px solid var(--line);
  font-size:.85rem; color:var(--text);
}
/* Os 8 cenários ocupam a mesma célula: a grelha dimensiona-se pelo mais alto e
   a consola nunca muda de altura ao trocar de cenário nem ao escrever. */
.mcx .mcx-stack{ display:grid; }
.mcx .mcx-stack-item{
  grid-area:1 / 1; min-width:0;
  visibility:hidden; pointer-events:none;
  display:flex; flex-direction:column;
}
.mcx .mcx-stack-item[data-on="true"]{ visibility:visible; pointer-events:auto; }
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
  margin-top:auto;
}
.mcx .mcx-console-footer{
  text-align:right; font-size:10px; letter-spacing:.13em;
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
  animation-play-state:running;
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
.mcx .mcx-chips{ display:flex; flex-wrap:wrap; gap:6px; margin-top:auto; }
.mcx .mcx-chip-sm{
  border:1px solid var(--line); border-radius:999px; padding:5px 11px;
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.09em;
  text-transform:uppercase; color:var(--faint);
  background:rgba(255,255,255,.025); white-space:nowrap;
}
.mcx .mcx-hier{ display:flex; flex-direction:column; gap:6px; margin-top:auto; }
.mcx .mcx-hier-row{
  display:flex; align-items:center; gap:10px;
  border:1px solid var(--line); border-left:2px solid rgba(242,68,0,.5);
  border-radius:8px; padding:7px 11px; background:rgba(255,255,255,.02);
}
.mcx .mcx-hier-role{
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.11em;
  text-transform:uppercase; color:var(--brand-hi); min-width:66px;
}
.mcx .mcx-hier-scope{ font-size:.78rem; color:var(--faint); }
/* o tile de largura total ganha duas colunas: texto à esquerda, ligações à direita */
@media (min-width:1080px){
  .mcx .mcx-b-full .mcx-tile{
    display:grid; grid-template-columns:1fr 1fr; gap:30px; align-items:center;
  }
  .mcx .mcx-b-full .mcx-tile-ico{ grid-column:1; }
  .mcx .mcx-b-full .mcx-h3{ grid-column:1; grid-row:2; }
  .mcx .mcx-b-full .mcx-body{ grid-column:1; grid-row:3; }
  .mcx .mcx-b-full .mcx-chips{ grid-column:2; grid-row:1 / span 3; margin-top:0; align-content:center; }
}

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

.mcx .mcx-readout-cell strong{ font-size:.92rem; color:var(--text); font-weight:600; }
.mcx .mcx-calc-note{
  margin:16px 0 0; font-size:.82rem; line-height:1.55; color:var(--faint); max-width:52ch;
}
.mcx .mcx-calc-cta{ margin-top:14px; align-self:flex-start; }

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

/* ---- formulários (entrar, recuperar senha, checkout) --------------------- */
.mcx .mcx-form{ display:flex; flex-direction:column; gap:16px; }
.mcx .mcx-form-field{ display:flex; flex-direction:column; gap:7px; }
.mcx .mcx-label{
  font-family:var(--f-mono); font-size:10px; letter-spacing:.15em;
  text-transform:uppercase; color:var(--faint);
}
.mcx .mcx-input{
  width:100%; appearance:none;
  background:rgba(255,255,255,.035);
  border:1px solid var(--line-strong);
  border-radius:11px; padding:13px 14px;
  color:var(--text); font-family:var(--f-body); font-size:.95rem;
  transition:border-color .16s ease,background .16s ease,box-shadow .16s ease;
}
.mcx .mcx-input::placeholder{ color:var(--faint); }
.mcx .mcx-input:hover{ border-color:rgba(255,255,255,.28); }
.mcx .mcx-input:focus{
  outline:none; border-color:var(--brand);
  background:rgba(255,255,255,.055);
  box-shadow:0 0 0 3px rgba(242,68,0,.16) !important;
}
.mcx .mcx-input[aria-invalid="true"]{ border-color:var(--crit-line); }
.mcx .mcx-input-wrap{ position:relative; display:flex; }
.mcx .mcx-input-btn{
  position:absolute; right:6px; top:50%; transform:translateY(-50%);
  display:inline-flex; align-items:center; justify-content:center;
  width:34px; height:34px; border-radius:9px; border:0; cursor:pointer;
  background:transparent; color:var(--faint);
}
.mcx .mcx-input-btn:hover{ color:var(--text); background:rgba(255,255,255,.06); }
.mcx .mcx-hint{ font-size:.8rem; color:var(--faint); }
.mcx .mcx-alert{
  display:flex; align-items:flex-start; gap:10px;
  border-radius:11px; padding:12px 14px; font-size:.875rem; line-height:1.5;
  border:1px solid var(--line-strong); background:rgba(255,255,255,.03); color:var(--muted);
}
.mcx .mcx-alert svg{ flex-shrink:0; margin-top:2px; }
.mcx .mcx-alert-error{
  border-color:var(--crit-line); background:rgba(163,44,44,.13); color:#F3B9B4;
}
.mcx .mcx-alert-ok{
  border-color:rgba(25,206,114,.34); background:var(--live-dim); color:#9BE9C4;
}

/* ---- ecrãs de entrada ---------------------------------------------------- */
/* Layout de duas colunas dos ecrãs de entrada: painel de marca + formulário. */
.mcx.mcx-auth-split{ display:flex; min-height:100dvh; }
@media (min-width:1024px){
  .mcx.mcx-auth-split .mcx-auth-aside{
    display:flex !important; flex-direction:column; justify-content:center;
    width:clamp(400px,36vw,520px); flex:0 0 auto; overflow:hidden;
  }
}
.mcx .mcx-auth{
  min-height:100dvh; display:flex; flex-direction:column;
  position:relative; overflow:hidden;
}
.mcx .mcx-auth-body{
  flex:1; display:grid; grid-template-columns:1fr; align-items:center;
  gap:clamp(34px,5vw,64px);
  padding:clamp(38px,6vw,72px) 24px clamp(48px,7vw,80px);
  max-width:1120px; margin:0 auto; width:100%;
  position:relative; z-index:1;
}
@media (min-width:960px){ .mcx .mcx-auth-body{ grid-template-columns:1fr .92fr; } }
.mcx .mcx-auth-card{
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.014));
  border:1px solid var(--line-strong);
  border-radius:20px; padding:clamp(26px,3.6vw,38px);
  box-shadow:0 40px 90px -55px rgba(0,0,0,.95) !important;
  width:100%; max-width:460px;
}
.mcx .mcx-auth-aside{ display:flex; flex-direction:column; gap:22px; max-width:520px; }
.mcx .mcx-auth-points{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:13px; }
.mcx .mcx-auth-points li{
  display:grid; grid-template-columns:18px 1fr; gap:11px;
  font-size:.92rem; line-height:1.5; color:var(--muted);
}
.mcx .mcx-auth-points svg{ margin-top:3px; color:var(--live); }
.mcx .mcx-auth-foot{
  border-top:1px solid var(--line); padding:18px 24px calc(22px + env(safe-area-inset-bottom));
  display:flex; flex-wrap:wrap; gap:8px 20px; justify-content:center; align-items:center;
  position:relative; z-index:1;
}

/* ---- demonstração ao vivo (hero) -----------------------------------------
   Uma conversa que cresce, com a agenda e o CRM a reagir. A fila tem ALTURA
   FIXA e rola por dentro: é assim que as mensagens podem acumular sem a caixa
   crescer e empurrar a página a cada mensagem nova. */

.mcx .mcx-live{
  border:1px solid var(--line-strong); border-radius:18px; overflow:hidden; min-width:0;
  background:linear-gradient(180deg,#0B121A,#070C11);
  box-shadow:0 40px 90px -50px rgba(0,0,0,.95) !important;
}
.mcx .mcx-live-bar{
  display:flex; align-items:center; gap:10px; padding:11px 14px;
  border-bottom:1px solid var(--line); background:rgba(255,255,255,.022);
}
.mcx .mcx-live-play{
  display:inline-flex; align-items:center; gap:5px; cursor:pointer;
  border:1px solid var(--line); border-radius:999px; padding:4px 10px;
  background:rgba(255,255,255,.03); color:var(--muted);
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.1em; text-transform:uppercase;
  transition:border-color .2s ease,color .2s ease;
}
.mcx .mcx-live-play:hover{ border-color:rgba(242,68,0,.5); color:var(--brand-hi); }

.mcx .mcx-live-prog{ display:block; height:2px; background:rgba(255,255,255,.06); }
.mcx .mcx-live-prog i{
  display:block; height:100%; background:linear-gradient(90deg,var(--brand),var(--brand-hi));
}

.mcx .mcx-live-sec{ border-bottom:1px solid var(--line); min-width:0; }
.mcx .mcx-live-head{
  display:flex; align-items:center; gap:7px; margin:0; padding:8px 13px;
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.14em;
  text-transform:uppercase; color:var(--faint);
  background:rgba(255,255,255,.014); border-bottom:1px solid var(--line-soft);
}
.mcx .mcx-live-head svg{ color:var(--brand); flex:none; }

/* a fila: altura fixa, rola por dentro */
.mcx .mcx-live-thread{
  height:214px; overflow-y:auto; overscroll-behavior:contain;
  padding:13px; display:flex; flex-direction:column; gap:8px;
  scrollbar-width:thin; scrollbar-color:var(--line-strong) transparent;
}
.mcx .mcx-live-thread::-webkit-scrollbar{ width:4px; }
.mcx .mcx-live-thread::-webkit-scrollbar-thumb{ background:var(--line-strong); border-radius:99px; }
.mcx .mcx-live-thread .mcx-bubble{
  margin:0; font-size:.82rem; line-height:1.45; padding:9px 12px; max-width:90%;
}
/* As mensagens assentam EM BAIXO e crescem para cima, como em qualquer
   conversa: no início da história a caixa não fica com um vazio enorme por
   baixo da primeira bolha (medidos 123px).

   Tem de vir DEPOIS da regra acima e com a mesma especificidade — o atalho
   margin:0 das bolhas ganhava a um simples > *:first-child. E é margin-top:auto
   em vez de justify-content:flex-end porque este último torna o topo da lista
   inalcançável quando o conteúdo passa a ser mais alto que a caixa. */
.mcx .mcx-live-thread .mcx-bubble:first-child,
.mcx .mcx-live-thread .mcx-live-sys:first-child{ margin-top:auto; }
/* O lado de cada bolha por align-self, e não pelo margin-left:auto da regra
   global: o atalho margin:0 acima anula margens, e sem isto as falas do agente
   ficavam encostadas à esquerda, como se fossem do cliente. */
.mcx .mcx-live-thread .mcx-bubble-in{ align-self:flex-start; }
.mcx .mcx-live-thread .mcx-bubble-out{ align-self:flex-end; }
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-live-thread > *{ animation:mcx-live-in .3s cubic-bezier(.22,1,.36,1) both; }
}
@keyframes mcx-live-in{
  from{ opacity:0; transform:translateY(6px) scale(.98); }
  to{ opacity:1; transform:none; }
}
.mcx .mcx-live-sys{
  display:flex; align-items:center; justify-content:center; gap:6px; margin:2px 0;
  font-family:var(--f-mono); font-size:8px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint);
}

/* o agente a escrever */
.mcx .mcx-live-dots{
  display:inline-flex; align-items:center; gap:5px; align-self:flex-end;
  width:auto; max-width:none; padding:10px 13px;
}
.mcx .mcx-live-dots i{ width:5px; height:5px; border-radius:99px; background:var(--brand-hi); opacity:.45; }
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-live-dots i{ animation:mcx-dots 1.05s ease-in-out infinite; }
  .mcx .mcx-live-dots i:nth-child(2){ animation-delay:.16s; }
  .mcx .mcx-live-dots i:nth-child(3){ animation-delay:.32s; }
}
@keyframes mcx-dots{
  0%,60%,100%{ transform:translateY(0); opacity:.38; }
  30%{ transform:translateY(-4px); opacity:1; }
}

/* agenda + crm lado a lado */
.mcx .mcx-live-panels{ display:grid; grid-template-columns:1fr 1fr; }
.mcx .mcx-live-panels .mcx-live-sec:first-child{ border-right:1px solid var(--line); }

.mcx .mcx-live-grid{
  display:grid; grid-template-columns:auto repeat(4,1fr); gap:4px;
  align-items:center; padding:12px;
}
.mcx .mcx-live-day, .mcx .mcx-live-hour{
  font-family:var(--f-mono); font-size:8px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--faint); text-align:center;
}
.mcx .mcx-live-hour{ text-align:right; padding-right:4px; }
.mcx .mcx-live-slot{
  position:relative; height:20px; border-radius:5px;
  border:1px solid var(--line); background:rgba(255,255,255,.022);
  transition:background .4s ease,border-color .4s ease;
}
.mcx .mcx-live-slot[data-s="ocupado"]{ background:rgba(255,255,255,.09); border-color:var(--line-strong); }
.mcx .mcx-live-slot[data-s="proposto"]{
  background:var(--brand-dim); border-color:rgba(242,68,0,.55); border-style:dashed;
}
.mcx .mcx-live-slot[data-s="marcado"]{
  background:linear-gradient(180deg,var(--brand-hi),var(--brand)); border-color:var(--brand);
}
.mcx .mcx-live-slot[data-flash="true"]::after{
  content:""; position:absolute; inset:-3px; border-radius:7px;
  border:1px solid var(--brand); pointer-events:none; opacity:0;
}
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-live-slot[data-flash="true"]::after{ animation:mcx-slot-pop .9s ease-out both; }
}
@keyframes mcx-slot-pop{
  0%{ opacity:1; transform:scale(.85); }
  100%{ opacity:0; transform:scale(1.6); }
}

.mcx .mcx-live-board{ display:grid; grid-template-columns:repeat(3,1fr); gap:4px; padding:12px; }
.mcx .mcx-live-col{
  border:1px solid var(--line); border-radius:7px; padding:6px 4px; min-height:62px;
  background:rgba(255,255,255,.018);
  transition:border-color .35s ease,background .35s ease;
}
.mcx .mcx-live-col[data-on="true"]{ border-color:rgba(242,68,0,.45); background:var(--brand-dim); }
.mcx .mcx-live-colname{
  display:block; font-family:var(--f-mono); font-size:7px; letter-spacing:.06em;
  text-transform:uppercase; color:var(--faint); margin-bottom:5px; text-align:center;
}
.mcx .mcx-live-card{
  position:relative; z-index:3;
  border:1px solid rgba(242,68,0,.5); border-radius:5px; padding:5px 4px;
  background:linear-gradient(160deg,rgba(242,68,0,.24),rgba(242,68,0,.09));
  font-size:9.5px; font-weight:600; color:var(--text); text-align:center;
}

/* os chips do que ficou feito. Ficam sempre no DOM, invisíveis até acenderem:
   é o que impede a consola de mudar de altura quando eles aparecem. */
.mcx .mcx-live-fx{
  list-style:none; margin:0; padding:11px 13px; display:flex; flex-wrap:wrap; gap:6px;
  background:rgba(255,255,255,.015); min-height:38px;
}
.mcx .mcx-live-fx li{
  display:inline-flex; align-items:center; gap:5px;
  border:1px solid rgba(25,206,114,.3); background:var(--live-dim);
  border-radius:999px; padding:4px 9px;
  font-family:var(--f-mono); font-size:8px; letter-spacing:.06em;
  text-transform:uppercase; color:#9BE9C4;
  opacity:0; transform:translateY(4px);
  transition:opacity .35s ease,transform .35s ease;
}
.mcx .mcx-live-fx[data-on="true"] li{
  opacity:1; transform:none; transition-delay:calc(var(--i) * 90ms);
}
.mcx .mcx-live-fx svg{ color:var(--live); }

@media (max-width:520px){
  .mcx .mcx-live-thread{ height:180px; }
  .mcx .mcx-live-panels{ grid-template-columns:1fr; }
  .mcx .mcx-live-panels .mcx-live-sec:first-child{ border-right:0; }
  .mcx .mcx-live-slot{ height:17px; }
}

/* ---- página do agendamento -----------------------------------------------
   Sem palco, sem temporizadores: a prova está toda no ecrã ao mesmo tempo e a
   pessoa lê a parte que lhe interessa. */

/* padding-top, NUNCA o atalho: .mcx-sec vive no mesmo elemento que .mcx-shell
   e o atalho apagava o padding lateral dele — no telemóvel os cartões
   encostavam aos 375px do ecrã, sem margem nenhuma. */
.mcx .mcx-sec{ padding-top:clamp(56px,8vw,104px); }
.mcx .mcx-lead-tight{ max-width:62ch; margin-top:14px; }

/* hero */
.mcx .mcx-ag-hero{
  display:grid; gap:clamp(28px,4vw,52px); align-items:center;
  padding-top:clamp(48px,7vw,84px);
}
@media (min-width:1000px){ .mcx .mcx-ag-hero{ grid-template-columns:1.05fr .95fr; } }
.mcx .mcx-ag-hero-text{ min-width:0; }
.mcx .mcx-ag-cta{ display:flex; flex-wrap:wrap; gap:12px; margin-top:26px; }
.mcx .mcx-ag-trust{
  list-style:none; margin:26px 0 0; padding:0;
  display:flex; flex-wrap:wrap; gap:9px;
}
.mcx .mcx-ag-trust li{
  display:inline-flex; align-items:center; gap:7px;
  border:1px solid var(--line); border-radius:999px; padding:7px 13px;
  background:rgba(255,255,255,.02); color:var(--muted); font-size:.8rem;
}
.mcx .mcx-ag-trust svg{ color:var(--live); flex:none; }

/* a prova do hero */
.mcx .mcx-ag-proof{
  border:1px solid var(--line-strong); border-radius:18px; overflow:hidden; min-width:0;
  background:linear-gradient(180deg,#0B121A,#070C11);
  box-shadow:0 40px 90px -50px rgba(0,0,0,.95) !important;
}
.mcx .mcx-ag-proof-bar{
  display:flex; align-items:center; gap:10px; padding:12px 16px;
  border-bottom:1px solid var(--line); background:rgba(255,255,255,.022);
}
.mcx .mcx-ag-proof-body{ padding:16px; display:flex; flex-direction:column; gap:10px; }
.mcx .mcx-ag-proof-out{
  list-style:none; margin:0; padding:12px 16px; display:flex; flex-wrap:wrap; gap:8px;
  border-top:1px solid var(--line); background:rgba(255,255,255,.015);
}
.mcx .mcx-ag-proof-out li{
  display:inline-flex; align-items:center; gap:6px;
  border:1px solid rgba(25,206,114,.3); background:var(--live-dim);
  border-radius:999px; padding:5px 10px;
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.07em;
  text-transform:uppercase; color:#9BE9C4;
}
.mcx .mcx-ag-proof-out svg{ color:var(--live); }

/* o que dói hoje */
.mcx .mcx-ag-dor{ padding-top:clamp(44px,6vw,72px); }
.mcx .mcx-ag-dor-grid{ display:grid; gap:12px; }
@media (min-width:860px){ .mcx .mcx-ag-dor-grid{ grid-template-columns:repeat(3,1fr); } }
.mcx .mcx-ag-dor-item{
  display:flex; gap:10px; margin:0; padding:16px 18px;
  border:1px solid var(--line); border-left:2px solid var(--crit-line);
  border-radius:12px; background:rgba(255,255,255,.018);
  color:var(--muted); font-size:.9rem; line-height:1.5;
}
.mcx .mcx-ag-dor-item svg{ color:#E06666; flex:none; margin-top:3px; }

/* filtros das situações */
.mcx .mcx-filtros{ display:flex; flex-wrap:wrap; gap:9px; margin:28px 0 22px; }
.mcx .mcx-filtro{
  display:flex; flex-direction:column; gap:2px; text-align:left; cursor:pointer;
  border:1px solid var(--line); border-radius:12px; padding:10px 16px;
  background:rgba(255,255,255,.02); color:var(--muted);
  font-size:.86rem; font-weight:600;
  transition:border-color .2s ease,background .2s ease,color .2s ease;
}
.mcx .mcx-filtro small{
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.1em;
  text-transform:uppercase; font-weight:400; color:var(--faint);
}
.mcx .mcx-filtro:hover{ border-color:var(--line-strong); color:var(--text); }
.mcx .mcx-filtro[data-on="true"]{
  border-color:rgba(242,68,0,.5); background:var(--brand-dim); color:var(--text);
}
.mcx .mcx-filtro[data-on="true"] small{ color:var(--brand-hi); }

/* as situações */
.mcx .mcx-sits{ display:grid; gap:14px; }
@media (min-width:760px){ .mcx .mcx-sits{ grid-template-columns:repeat(2,1fr); } }
@media (min-width:1240px){ .mcx .mcx-sits{ grid-template-columns:repeat(3,1fr); } }
.mcx .mcx-sit{
  display:flex; flex-direction:column; min-width:0;
  border:1px solid var(--line); border-radius:16px; overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.008));
}
.mcx .mcx-sit[data-t="protege"]{ border-color:rgba(242,68,0,.28); }
.mcx .mcx-sit-top{
  display:flex; align-items:center; gap:9px; padding:13px 15px;
  border-bottom:1px solid var(--line-soft); background:rgba(255,255,255,.02);
}
.mcx .mcx-sit-mark{ display:inline-flex; flex:none; }
.mcx .mcx-sit[data-t="protege"] .mcx-sit-mark{ color:var(--brand-hi); }
.mcx .mcx-sit[data-t="resolve"] .mcx-sit-mark{ color:var(--live); }
.mcx .mcx-sit-tag{
  margin:0; font-size:.88rem; font-weight:650; color:var(--text);
  line-height:1.32; min-width:0; flex:1;
}
.mcx .mcx-sit-code{
  flex:none; font-size:8.5px; letter-spacing:.06em; color:var(--faint);
}
.mcx .mcx-sit-talk{ padding:15px; display:flex; flex-direction:column; gap:9px; flex:1; }
.mcx .mcx-sit-trigger{
  display:flex; align-items:center; gap:6px; margin:0;
  font-family:var(--f-mono); font-size:8.5px; letter-spacing:.1em;
  text-transform:uppercase; color:var(--faint);
}
.mcx .mcx-sit-who{
  display:block; font-family:var(--f-mono); font-size:8px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--faint); margin-bottom:4px;
}
.mcx .mcx-sit-talk .mcx-bubble{ max-width:100%; margin:0; font-size:.85rem; }
.mcx .mcx-sit-did{
  list-style:none; margin:0; padding:12px 15px; display:flex; flex-wrap:wrap; gap:7px;
  border-top:1px solid var(--line-soft); background:rgba(255,255,255,.014);
}
.mcx .mcx-sit-did li{
  display:inline-flex; align-items:center; gap:5px;
  font-family:var(--f-mono); font-size:8px; letter-spacing:.06em;
  text-transform:uppercase; color:var(--muted);
}
.mcx .mcx-sit-did svg{ color:var(--live); flex:none; }

/* o que ele nunca faz */
.mcx .mcx-nunca{ display:grid; gap:12px; margin-top:30px; }
@media (min-width:900px){ .mcx .mcx-nunca{ grid-template-columns:repeat(2,1fr); } }
.mcx .mcx-nunca-item{
  height:100%; padding:20px 22px; border:1px solid var(--line); border-radius:14px;
  background:rgba(255,255,255,.02);
}
.mcx .mcx-nunca-item h3{
  display:flex; align-items:center; gap:9px; margin:0 0 8px;
  font-size:1rem; font-weight:650; color:var(--text); line-height:1.3;
}
.mcx .mcx-nunca-item h3 svg{ color:var(--brand); flex:none; }
.mcx .mcx-nunca-item p{ margin:0; color:var(--muted); font-size:.9rem; line-height:1.6; }

/* passos */
.mcx .mcx-passos{ display:grid; gap:12px; margin-top:30px; }
@media (min-width:860px){ .mcx .mcx-passos{ grid-template-columns:repeat(3,1fr); } }
.mcx .mcx-passo{
  height:100%; padding:22px; border:1px solid var(--line); border-radius:14px;
  background:rgba(255,255,255,.02);
}
.mcx .mcx-passo-n{
  display:block; font-size:11px; letter-spacing:.14em; color:var(--brand); margin-bottom:12px;
}
.mcx .mcx-passo h3{ margin:0 0 7px; font-size:1.02rem; font-weight:650; color:var(--text); }
.mcx .mcx-passo p{ margin:0; color:var(--muted); font-size:.9rem; line-height:1.6; }

/* faq */
.mcx .mcx-faq{ margin-top:28px; border-top:1px solid var(--line); }
.mcx .mcx-faq-item{ border-bottom:1px solid var(--line); }
.mcx .mcx-faq-item summary{
  cursor:pointer; padding:18px 2px; list-style:none;
  font-size:1rem; font-weight:600; color:var(--text);
  display:flex; align-items:center; justify-content:space-between; gap:16px;
}
.mcx .mcx-faq-item summary::-webkit-details-marker{ display:none; }
.mcx .mcx-faq-item summary::after{
  content:"+"; flex:none; color:var(--brand); font-size:1.2rem; line-height:1;
}
.mcx .mcx-faq-item[open] summary::after{ content:"–"; }
.mcx .mcx-faq-item p{
  margin:0; padding:0 2px 20px; color:var(--muted); font-size:.94rem;
  line-height:1.68; max-width:74ch;
}

/* cta final */
.mcx .mcx-cta-final{
  text-align:center; padding:clamp(40px,6vw,66px) 24px;
  border:1px solid rgba(242,68,0,.28); border-radius:20px;
  background:radial-gradient(120% 140% at 50% 0%,rgba(242,68,0,.14),transparent 62%);
}
.mcx .mcx-cta-final svg{ color:var(--brand); }
.mcx .mcx-cta-final .mcx-lead{ margin:12px auto 26px; }

/* ---- lista de espera: coluna do argumento --------------------------------
   Era prosa cinzenta em três blocos. Numa página que pede o WhatsApp de
   alguém, o texto tem de ser lido de relance — e a pergunta silenciosa
   ("isto existe mesmo?") pede prova, não parágrafo. */

.mcx .mcx-wl-punch{
  margin:0; font-size:1.08rem; line-height:1.6; color:var(--text);
  max-width:54ch;
}
.mcx .mcx-wl-punch strong{ color:var(--brand-hi); font-weight:700; }

.mcx .mcx-wl-perks{ list-style:none; margin:0; padding:0; display:grid; gap:11px; }
.mcx .mcx-wl-perks li{
  display:flex; align-items:flex-start; gap:13px;
  padding:14px 16px; border:1px solid var(--line); border-radius:13px;
  background:linear-gradient(140deg,rgba(255,255,255,.038),rgba(255,255,255,.012));
  color:var(--muted); font-size:.9rem; line-height:1.5;
}
.mcx .mcx-wl-perks li b{
  display:block; color:var(--text); font-size:.97rem; font-weight:650; margin-bottom:2px;
}
.mcx .mcx-wl-perk-ico{
  display:inline-flex; align-items:center; justify-content:center; flex:none;
  width:34px; height:34px; border-radius:10px;
  border:1px solid rgba(242,68,0,.35); background:var(--brand-dim); color:var(--brand-hi);
}

/* a data: o elemento que tem de saltar à vista na coluna */
.mcx .mcx-wl-date{
  position:relative; overflow:hidden;
  display:flex; align-items:center; gap:15px; padding:18px 20px;
  border:1px solid rgba(242,68,0,.42); border-radius:15px;
  background:linear-gradient(140deg,rgba(242,68,0,.19),rgba(242,68,0,.04));
}
.mcx .mcx-wl-date > svg{ color:var(--brand-hi); flex:none; }
.mcx .mcx-wl-date .mcx-mono{ margin-bottom:3px; color:var(--brand-hi); }
.mcx .mcx-wl-date strong{
  display:block; font-family:var(--f-display); font-weight:700;
  font-size:1.5rem; letter-spacing:-.02em; color:var(--text);
}
/* um brilho que atravessa a caixa de tempos a tempos, para o olho voltar lá */
.mcx .mcx-wl-date::after{
  content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(100deg,transparent 42%,rgba(255,255,255,.11) 50%,transparent 58%);
  transform:translateX(-100%);
}
@media (prefers-reduced-motion:no-preference){
  .mcx .mcx-wl-date::after{ animation:mcx-wl-shine 4.5s ease-in-out 1.2s infinite; }
}
@keyframes mcx-wl-shine{
  0%{ transform:translateX(-100%); }
  32%,100%{ transform:translateX(100%); }
}

.mcx .mcx-wl-demo{ display:grid; gap:11px; }
.mcx .mcx-wl-demo-lead{
  display:flex; align-items:center; gap:8px; margin:0;
  font-family:var(--f-mono); font-size:9.5px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--faint);
}
.mcx .mcx-wl-demo-lead svg{ color:var(--brand); flex:none; }

/* ---- lista de espera ------------------------------------------------------ */
.mcx .mcx-error{ font-size:.8rem; color:#F3B9B4; }
.mcx select.mcx-input{
  appearance:none; cursor:pointer; padding-right:38px;
  background-image:linear-gradient(45deg,transparent 50%,var(--faint) 50%),linear-gradient(135deg,var(--faint) 50%,transparent 50%);
  background-position:calc(100% - 19px) 50%,calc(100% - 13px) 50%;
  background-size:6px 6px,6px 6px; background-repeat:no-repeat;
}
.mcx select.mcx-input option{ background:var(--surface); color:var(--text); }
.mcx .mcx-spin{ animation:mcx-spin .9s linear infinite; }
@keyframes mcx-spin{ to{ transform:rotate(360deg); } }
.mcx .mcx-waitgrid{ display:grid; gap:14px; grid-template-columns:1fr; }
@media (min-width:760px){ .mcx .mcx-waitgrid{ grid-template-columns:repeat(2,1fr); } }
.mcx .mcx-waitgrid > div{ height:100%; }
@media (min-width:1000px){
  .mcx #mcx-waitlist-grid{ grid-template-columns:1.05fr .95fr; }
}

/* ---- guias por nicho (ligação interna da home) ---------------------------- */
.mcx .mcx-niches{
  list-style:none; margin:34px 0 0; padding:0;
  display:grid; gap:8px; grid-template-columns:1fr;
}
@media (min-width:640px){ .mcx .mcx-niches{ grid-template-columns:repeat(2,1fr); } }
@media (min-width:1024px){ .mcx .mcx-niches{ grid-template-columns:repeat(3,1fr); } }
.mcx .mcx-niches a{
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  border:1px solid var(--line); border-radius:11px; padding:12px 14px;
  background:rgba(255,255,255,.022); color:var(--muted);
  font-size:.875rem; line-height:1.4; text-decoration:none;
  transition:color .16s ease,border-color .16s ease,background .16s ease;
}
.mcx .mcx-niches a:hover{
  color:var(--text); border-color:rgba(242,68,0,.4); background:var(--brand-dim);
}
.mcx .mcx-niches svg{ flex-shrink:0; color:var(--brand); opacity:.7; }

/* ---- páginas legais ------------------------------------------------------- */
.mcx .mcx-legal{
  margin-top:36px; display:flex; flex-direction:column; gap:30px;
  font-size:.93rem; line-height:1.72; color:var(--muted);
}
.mcx .mcx-legal p{ margin:0 0 12px; max-width:74ch; }
.mcx .mcx-legal p:last-child{ margin-bottom:0; }
.mcx .mcx-legal ul{ margin:10px 0 0; padding-left:20px; display:flex; flex-direction:column; gap:7px; max-width:74ch; }
.mcx .mcx-legal li::marker{ color:var(--brand); }
.mcx .mcx-legal strong{ color:var(--text); font-weight:600; }
.mcx .mcx-legal a{ color:var(--brand-hi); }

/* ---- tabela comparativa -------------------------------------------------- */
.mcx .mcx-table-wrap{
  overflow-x:auto; border:1px solid var(--line); border-radius:16px;
  background:var(--surface);
}
.mcx table.mcx-table{ border-collapse:collapse; width:100%; min-width:640px; font-size:.875rem; }
.mcx .mcx-table th{
  font-family:var(--f-mono); font-size:10px; font-weight:600; letter-spacing:.13em;
  text-transform:uppercase; color:var(--faint); text-align:left;
  padding:14px 16px; border-bottom:1px solid var(--line); white-space:nowrap;
  position:sticky; top:0; background:var(--surface); z-index:1;
}
.mcx .mcx-table th.pop{ color:var(--brand-hi); }
.mcx .mcx-table td{
  padding:13px 16px; border-bottom:1px solid var(--line-soft, rgba(255,255,255,.05));
  color:var(--muted); vertical-align:top;
}
.mcx .mcx-table tr:last-child td{ border-bottom:0; }
.mcx .mcx-table td:first-child{ color:var(--text); font-weight:600; }
.mcx .mcx-table .mcx-cat td{
  background:rgba(255,255,255,.028); color:var(--brand-hi);
  font-family:var(--f-mono); font-size:10px; letter-spacing:.14em; text-transform:uppercase;
}
.mcx .mcx-table col.pop, .mcx .mcx-table td.pop{ background:rgba(242,68,0,.06); }

/* ---- resumo do checkout -------------------------------------------------- */
.mcx .mcx-summary{
  display:flex; flex-direction:column; gap:14px;
  border:1px solid var(--line-strong); border-radius:18px;
  background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.014));
  padding:24px;
}
.mcx .mcx-summary-row{
  display:flex; align-items:baseline; justify-content:space-between; gap:16px;
  font-size:.9rem; color:var(--muted);
}
.mcx .mcx-summary-row b{ color:var(--text); font-weight:600; font-variant-numeric:tabular-nums; }
.mcx .mcx-summary-total{
  border-top:1px solid var(--line); padding-top:14px;
  display:flex; align-items:baseline; justify-content:space-between; gap:16px;
}
.mcx .mcx-summary-total span{ font-family:var(--f-mono); font-size:10px; letter-spacing:.15em; text-transform:uppercase; color:var(--faint); }
.mcx .mcx-summary-total b{
  font-family:var(--f-display); font-weight:700; font-size:1.9rem;
  letter-spacing:-.03em; color:var(--text); font-variant-numeric:tabular-nums;
}

/* ---- estado de sucesso --------------------------------------------------- */
.mcx .mcx-success-ring{
  width:64px; height:64px; border-radius:50%;
  display:flex; align-items:center; justify-content:center;
  border:1px solid rgba(25,206,114,.4); background:var(--live-dim); color:var(--live);
}

/* ---- entrada em cena ------------------------------------------------------
   O conteúdo nasce VISÍVEL. O estado escondido só existe depois de um script
   inline armar o contentor, por isso nunca chega ao HTML do servidor: um
   rastreador que não executa JS (a maioria dos bots de IA) lê o texto todo, e
   o Google não recebe a manchete principal com opacity:0. */
.mcx .mcx-reveal, .mcx .mcx-enter{ opacity:1; transform:none; }
.mcx.mcx-armed .mcx-reveal{
  opacity:0; transform:translateY(22px);
  transition:opacity .55s cubic-bezier(.22,1,.36,1), transform .55s cubic-bezier(.22,1,.36,1);
  transition-delay:var(--mcx-d,0ms);
}
.mcx.mcx-armed .mcx-reveal.is-in{ opacity:1; transform:none; }
.mcx.mcx-armed .mcx-enter{
  animation:mcx-enter .6s cubic-bezier(.22,1,.36,1) both;
  animation-delay:var(--mcx-d,0ms);
}
@keyframes mcx-enter{ from{ opacity:0; transform:translateY(18px); } to{ opacity:1; transform:none; } }
@media (prefers-reduced-motion:reduce){
  .mcx.mcx-armed .mcx-reveal{ opacity:1; transform:none; transition:none; }
  .mcx.mcx-armed .mcx-enter{ animation:none; }
}

@media (prefers-reduced-motion:reduce){
  .mcx *{ animation-duration:.001ms !important; animation-iteration-count:1 !important; transition-duration:.001ms !important; }
}
`;
/** Injeta a folha e abre o contexto `.mcx`. Todas as páginas do funil usam isto. */
export function McxPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Rede de segurança para navegação client-side, onde o script inline abaixo
  // já não corre. No primeiro carregamento é um no-op — a classe já está lá.
  useEffect(() => {
    ref.current?.classList.add("mcx-armed");
  }, []);

  return (
    <div
      ref={ref}
      className={className ? `mcx ${className}` : "mcx"}
      /* O script abaixo acrescenta `mcx-armed` antes da hidratação, então o
         className do servidor e o do cliente divergem de propósito. Sem isto
         o React reclama e pode repor a classe original, matando a animação. */
      suppressHydrationWarning
    >
      <style dangerouslySetInnerHTML={{ __html: MCX_SHEET }} />
      {/* Corre durante o parse, antes do primeiro paint: sem isto haveria um
          flash de conteúdo visível a desaparecer para depois animar. */}
      <script
        dangerouslySetInnerHTML={{
          __html: "document.currentScript.parentElement.classList.add('mcx-armed')",
        }}
      />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/**
 * Formatação à mão, de propósito. `Intl.NumberFormat` devolve espaços
 * diferentes (U+00A0 vs U+202F) consoante a versão do ICU do Node e a do
 * browser, e estas páginas renderizam o valor no servidor e recalculam-no no
 * cliente — o que rebentava a hidratação. Agrupar milhares em ponto é
 * determinista dos dois lados.
 */
export function groupDigits(value: number): string {
  const digits = Math.round(Math.abs(value)).toString();
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ".";
    out += digits[i];
  }
  return (value < 0 ? "-" : "") + out;
}

/** Valores redondos (calculadora, totais aproximados). */
export const BRL = { format: (v: number) => `R$ ${groupDigits(v)}` };
export const NUM = { format: (v: number) => groupDigits(v) };

/**
 * Preços mostram cêntimos quando existem, para bater exatamente com o
 * `formatBRL` usado no resto do produto. O anual do Solo dá R$ 80,51 —
 * arredondar para R$ 81 mostrava um preço que o checkout não cobra.
 */
export function priceBRL(value: number): string {
  const cents = Math.round(value * 100);
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  if (rest === 0) return `R$ ${groupDigits(whole)}`;
  return `R$ ${groupDigits(whole)},${String(rest).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Navegação por âncora
// ---------------------------------------------------------------------------

/**
 * Rola até a âncora na mão: o `next/link` do Next 14 nem sempre dispara o
 * scroll de `#hash`. Aceita `/#alvo` para os links funcionarem a partir de
 * qualquer página — fora da home o elemento não existe e a navegação normal
 * do Next segue o seu caminho.
 */
export function useHashNav() {
  return useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const hash = href.startsWith("#") ? href : href.startsWith("/#") ? href.slice(1) : null;
    if (!hash) return;
    const el = document.querySelector(hash);
    if (!el) return;
    event.preventDefault();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    history.pushState(null, "", href);
  }, []);
}

// ---------------------------------------------------------------------------
// Entrada em cena
// ---------------------------------------------------------------------------

/**
 * Não usa `useInView`/IntersectionObserver de propósito: quando o visitante
 * salta muitos ecrãs de uma vez (roda rápida, tecla End, âncora do menu), o
 * observador não chega a registar a interseção e a secção fica invisível para
 * sempre. `getBoundingClientRect` cobre os dois casos — o que está a entrar e
 * o que já foi ultrapassado.
 */
export function useEnteredView(ref: React.RefObject<HTMLElement>) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (entered) return;
    const check = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top < window.innerHeight - 60) setEntered(true);
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

export function Reveal({
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

  return (
    <div
      ref={ref}
      className={[className, "mcx-reveal", entered ? "is-in" : ""].filter(Boolean).join(" ")}
      style={delay ? ({ "--mcx-d": `${Math.round(delay * 1000)}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mcx-seclabel">
      <span>{children}</span>
      <i />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marca
// ---------------------------------------------------------------------------

export function LogoMark({ size = 30 }: { size?: number }) {
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
// Cabeçalho e rodapé partilhados
// ---------------------------------------------------------------------------

/** Âncoras absolutas para os links funcionarem a partir de qualquer página. */
const NAV_LINKS = [
  ["Como decide", "/#motor"],
  ["Recursos", "/#recursos"],
  ["Agendamento", "/agendamento"],
  ["Calculadora", "/#calculadora"],
  ["Planos", "/planos"],
  ["Blog", "/blog"],
] as const;

export function McxNav({ compact = false }: { compact?: boolean }) {
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

        {compact ? (
          <span style={{ flex: 1 }} />
        ) : (
          <div className="mcx-navlinks">
            {NAV_LINKS.map(([label, href]) => (
              <Link key={label} href={href} className="mcx-navlink" onClick={(e) => onHash(e, href)}>
                {label}
              </Link>
            ))}
          </div>
        )}

        <div className="mcx-navcta">
          <Link href="/login" className="mcx-navlink" style={{ fontWeight: 600 }}>
            Entrar
          </Link>
          <Link href="/planos" className="mcx-btn mcx-btn-primary" style={{ padding: "11px 20px" }}>
            Começar agora
          </Link>
        </div>

        {compact ? null : (
          <button
            type="button"
            className="mcx-burger"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
          >
            {open ? <CloseIcon size={19} /> : <Menu size={19} />}
          </button>
        )}
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

export function McxFooter() {
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
                <Link href="/#motor" onClick={(e) => onHash(e, "/#motor")}>
                  Como o agente decide
                </Link>
              </li>
              <li>
                <Link href="/#recursos" onClick={(e) => onHash(e, "/#recursos")}>
                  Recursos
                </Link>
              </li>
              <li>
                <Link href="/#calculadora" onClick={(e) => onHash(e, "/#calculadora")}>
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
