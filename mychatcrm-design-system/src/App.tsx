import React, { useState, useEffect, useRef } from 'react';
import { 
  Home, 
  Users, 
  Zap, 
  Bot, 
  MessageSquare, 
  Send, 
  Settings, 
  ChevronRight, 
  ChevronDown, 
  Layers, 
  Palette, 
  Type, 
  Maximize, 
  Grid as GridIcon, 
  Component, 
  Square, 
  Layout, 
  Smartphone, 
  CheckCircle2, 
  Search,
  Plus,
  Filter,
  Download,
  MoreVertical,
  Bell,
  Menu,
  X as CloseIcon,
  Info,
  BookOpen,
  ArrowRight,
  Sparkles,
  Shield,
  MousePointer2,
  Moon,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { typography } from './lib/design-system/typography';

// --- Types & Constants ---

const MENU_GROUPS = [
  {
    label: "Documentação",
    items: [
      { id: 'introduction', name: 'Introdução', icon: BookOpen },
      { id: 'foundations', name: 'Fundamentos Base', icon: Layers },
    ]
  },
  {
    label: "Design System",
    items: [
      { id: 'colors', name: 'Paleta de Cores', icon: Palette },
      { id: 'typography', name: 'Tipografia', icon: Type },
      { id: 'components', name: 'Componentes de UI', icon: Component },
      { id: 'layout', name: 'Layout & Grids', icon: GridIcon },
      { id: 'ux', name: 'Diretrizes de UX', icon: Smartphone },
    ]
  }
];

const MENU_ITEMS = MENU_GROUPS.flatMap(group => group.items);

const BRAND_ORANGE = "#F24400";
const BRAND_SECONDARY_DARK = "#0E1D29";
const BRAND_SECONDARY_ORANGE = "#B22A00";
const NEUTRAL_BLACK = "#000000";
const NEUTRAL_GRAY = "#F2F2F2";
const NEUTRAL_WHITE = "#FFFFFF";

// --- UI Components ---

const Button = ({ children, variant = 'primary', size = 'md', className = '', ...props }: any) => {
  const variants: any = {
    primary: 'bg-brand-primary text-white hover:bg-brand-secondary-orange shadow-sm active:scale-[0.98]',
    secondary: 'bg-brand-secondary text-white hover:bg-brand-dark shadow-sm active:scale-[0.98] dark:bg-zinc-800 dark:hover:bg-zinc-700',
    outline: 'bg-transparent border border-brand-border text-brand-dark hover:bg-brand-bg active:scale-[0.98] dark:text-white dark:hover:bg-zinc-900',
    ghost: 'bg-transparent text-brand-text-muted hover:bg-brand-bg hover:text-brand-dark active:scale-[0.98] dark:hover:bg-zinc-900 dark:hover:text-white',
    link: 'bg-transparent text-brand-primary hover:underline p-0 h-auto font-semibold',
    success: 'bg-brand-success text-white hover:bg-green-600 active:scale-[0.98]',
    danger: 'bg-red-500 text-white hover:bg-red-600 active:scale-[0.98]',
  };
  
  const sizes: any = {
    xs: 'px-3 py-1.5 text-[10px]',
    sm: 'px-5 py-2.5 text-xs',
    md: 'px-7 py-3.5 text-sm',
    lg: 'px-10 py-4.5 text-base font-bold',
  };

  const isLink = variant === 'link';

  return (
    <button 
      className={`${isLink ? '' : 'rounded-xl transition-all duration-200 border border-transparent focus:outline-none focus:ring-2 focus:ring-brand-primary/20'} ${typography.ui.button} flex items-center justify-center gap-2 ${variants[variant]} ${isLink ? '' : sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

const SectionHeader = ({ title, subtitle, anchor }: { title: string; subtitle?: string; anchor?: string }) => (
  <div id={anchor} className="mb-6 scroll-mt-20">
    <div className="flex items-center gap-2 mb-1">
      <div className="w-1 h-1 rounded-full bg-brand-primary" />
      <span className={typography.ui.overline + " text-brand-primary"}>{anchor ? anchor.replace('-', ' ') : 'Section'}</span>
    </div>
    <h2 className={typography.display.section + " mb-1.5"}>{title}</h2>
    {subtitle && <p className={typography.body.sm + " text-brand-text-muted max-w-3xl"}>{subtitle}</p>}
    <div className="h-px bg-brand-border mt-5 w-full" />
  </div>
);

// --- Content Sections ---

const IntroductionSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1 h-1 rounded-full bg-brand-primary" />
        <span className={typography.ui.overline + " text-brand-primary"}>Início</span>
      </div>
      <h1 className={typography.display.hero + " mb-4"}>MyChatCRM Identity System</h1>
      <p className={typography.body.lg + " text-brand-text-muted max-w-3xl"}>
        A documentação oficial para unificar nossa experiência visual e eficiência. Baseada em padrões modernos de alta densidade.
      </p>
    </div>
    
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="p-5 bg-surface rounded-xl border border-brand-border flex flex-col justify-between group">
        <div className="mb-4">
          <div className="text-brand-primary mb-3">
            <Sparkles size={28} strokeWidth={1.5} />
          </div>
          <h3 className={typography.heading.h4 + " mb-1.5"}>Comece a Criar</h3>
          <p className={typography.ui.caption}>
            Componentes modulares para construir fluxos de automação em minutos.
          </p>
        </div>
        <Button variant="primary" size="sm" className="w-fit">Ver Componentes <ArrowRight size={14} /></Button>
      </div>

      <div className="p-5 bg-brand-secondary text-white rounded-xl border border-brand-secondary flex flex-col justify-between group">
        <div className="mb-4">
          <div className="text-brand-primary mb-3">
            <Shield size={28} strokeWidth={1.5} />
          </div>
          <h3 className={typography.inverse.heading.h4 + " mb-1.5"}>Padrões de Qualidade</h3>
          <p className={typography.inverse.label.subtle}>
            Siga estas diretrizes para garantir softwares inclusivos.
          </p>
        </div>
        <Button variant="primary" size="sm" className="w-fit bg-brand-secondary-orange hover:bg-orange-700 border-none">Ler Diretrizes UX</Button>
      </div>
    </div>
  </motion.div>
);

const FoundationsSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
    <SectionHeader 
      title="Fundamentos Base" 
      subtitle="Os princípios que moldam nossa interface."
      anchor="foundations"
    />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {[
        { title: 'Velocidade', desc: 'Interfaces que respondem instantaneamente.', icon: Zap },
        { title: 'Intuição', desc: 'Design que fala a língua do usuário.', icon: MousePointer2 },
        { title: 'Escalabilidade', desc: 'Arquitetura de blocos ilimitada.', icon: Layers },
      ].map((item, i) => (
        <div key={i} className="p-4 bg-surface rounded-xl border border-brand-border hover:border-brand-primary/30 transition-all">
          <div className="text-brand-primary mb-3">
            <item.icon size={20} strokeWidth={1.5} />
          </div>
          <h3 className={typography.heading.h5 + " mb-1"}>{item.title}</h3>
          <p className={typography.ui.caption}>{item.desc}</p>
        </div>
      ))}
    </div>
  </motion.div>
);

const ColorsSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
    <SectionHeader 
      title="Paleta de Cores" 
      subtitle="Contraste entre Laranja e Azul Carvão."
      anchor="colors"
    />
    
    <div className="space-y-8">
      {/* Primary Section */}
      <div>
        <h3 className={typography.label.subtle + " mb-3"}>Primária</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <ColorCard name="Laranja Vibrante" hex={BRAND_ORANGE} label="Cor da marca" />
        </div>
      </div>

      {/* Secondary Section */}
      <div>
        <h3 className={typography.label.subtle + " mb-3"}>Secundárias</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <ColorCard name="Azul Carvão" hex={BRAND_SECONDARY_DARK} label="Navegação" />
          <ColorCard name="Laranja Dark" hex={BRAND_SECONDARY_ORANGE} label="Hover" />
          <ColorCard name="Success" hex="#00A650" label="Status" />
        </div>
      </div>

      {/* Neutral Section */}
      <div>
        <h3 className={typography.label.subtle + " mb-3"}>Neutras</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <ColorCard name="Preto" hex={NEUTRAL_BLACK} label="Tipografia" />
          <ColorCard name="Cinza" hex={NEUTRAL_GRAY} label="BG" />
          <ColorCard name="Branco" hex={NEUTRAL_WHITE} label="Surface" />
        </div>
      </div>
    </div>
  </motion.div>
);

const ColorCard = ({ name, hex, label }: { name: string; hex: string; label: string }) => (
  <div className="flex flex-col gap-2 group">
    <div 
      className="w-full h-16 rounded-xl border border-brand-border transition-colors duration-300" 
      style={{ backgroundColor: hex }} 
    />
    <div>
      <p className={typography.ui.caption}>{name}</p>
      <p className={typography.ui.caption + " opacity-70 mb-0.5 mt-1"}>{label}</p>
      <div className="flex items-center gap-1.5 mt-2">
        <code className={typography.ui.code + " bg-brand-bg dark:bg-zinc-900 text-brand-primary px-1.5 py-0.5 rounded-xl uppercase border dark:border-zinc-800"}>{hex}</code>
        <button 
          className={typography.ui.caption + " hover:text-brand-primary transition-colors uppercase font-bold"}
          onClick={() => navigator.clipboard.writeText(hex)}
        >
          Copy
        </button>
      </div>
    </div>
  </div>
);

const TypographySection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
    <SectionHeader 
      title="Sistemas de Texto" 
      subtitle="Finetuning de tracking e leading baseados nos tokens do Shadcn."
      anchor="typography"
    />
    <div className="bg-brand-bg border border-brand-border rounded-xl overflow-hidden">
      <div className="p-6 space-y-8 bg-surface">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-6">
            <div>
              <span className={typography.ui.overline + " block mb-1"}>H1 - Black Tight</span>
              <h1 className={typography.display.hero}>The CRM.</h1>
            </div>
            <div>
              <span className={typography.ui.overline + " block mb-1"}>H2 - Bold Tight</span>
              <h2 className={typography.display.feature}>Relacionamentos rápidos.</h2>
            </div>
            <div>
              <span className={typography.ui.overline + " block mb-1"}>UI Bold</span>
              <p className={typography.label.default}>Status: Active</p>
            </div>
          </div>

          <div className="p-5 bg-brand-bg rounded-xl space-y-4">
            <h4 className={typography.label.subtle + " mb-2"}>Typography Tokens</h4>
            <div className="space-y-3">
              <div className="flex justify-between items-center border-b border-brand-border pb-2">
                <span className={typography.ui.caption}>Letter Spacing</span>
                <code className={typography.ui.code}>tracking-tight</code>
              </div>
              <div className="flex justify-between items-center border-b border-brand-border pb-2">
                <span className={typography.ui.caption}>Line Height (UI)</span>
                <code className={typography.ui.code}>leading-none</code>
              </div>
              <div className="flex justify-between items-center border-b border-brand-border pb-2">
                <span className={typography.ui.caption}>Line Height (Text)</span>
                <code className={typography.ui.code}>leading-relaxed</code>
              </div>
              <div className="flex justify-between items-center">
                <span className={typography.ui.caption}>Weight (Default)</span>
                <code className={typography.ui.code}>font-medium</code>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="bg-brand-secondary p-6 flex flex-wrap gap-12 border-t border-brand-border">
        <div className="flex flex-col">
          <span className={typography.label.subtle + " text-zinc-400 mb-1"}>Font Family</span>
          <span className={typography.label.default + " text-white underline decoration-brand-primary decoration-2 underline-offset-4"}>Inter Variable</span>
        </div>
        <div className="flex flex-col">
          <span className={typography.label.subtle + " text-zinc-400 mb-1"}>Weights</span>
          <span className={typography.label.default + " text-white"}>400, 500, 600, 700, 900</span>
        </div>
        <div className="flex flex-col">
          <span className={typography.label.subtle + " text-zinc-400 mb-1"}>Border Radius (New)</span>
          <span className={typography.label.default + " text-white italic"}>Reduced 40% (Flat-ish)</span>
        </div>
      </div>
    </div>
  </motion.div>
);

const ComponentsSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
    <SectionHeader 
      title="Componentes de UI" 
      subtitle="Ações e controles padronizados com paddings generosos e bordas suaves."
      anchor="components"
    />
    
    <div className="space-y-12">
      {/* Botões - Documentação Visual */}
      <div className="bg-surface border border-brand-border rounded-xl overflow-hidden shadow-sm">
        <div className="p-6 border-b border-brand-bg bg-zinc-50/50 dark:bg-zinc-900/50">
          <h3 className={typography.heading.h4 + " text-brand-dark dark:text-white"}>Ações (Buttons)</h3>
          <p className={typography.body.sm + " text-brand-text-muted"}>Nossa escala de botões prioriza o respiro visual com padding horizontal 2.5x maior que o vertical.</p>
        </div>
        
        <div className="p-8 space-y-12">
          {/* Variantes */}
          <div className="space-y-6">
            <h4 className={typography.label.default + " text-brand-primary uppercase tracking-widest text-[10px]"}>Estilos de Botão</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="space-y-3">
                <Button variant="primary" className="w-full">Primary Action</Button>
                <code className="text-[10px] block text-center text-zinc-400">variant="primary"</code>
              </div>
              <div className="space-y-3">
                <Button variant="secondary" className="w-full text-white">Secondary</Button>
                <code className="text-[10px] block text-center text-zinc-400">variant="secondary"</code>
              </div>
              <div className="space-y-3">
                <Button variant="outline" className="w-full">Outline Action</Button>
                <code className="text-[10px] block text-center text-zinc-400">variant="outline"</code>
              </div>
              <div className="space-y-3">
                <Button variant="ghost" className="w-full">Ghost Link</Button>
                <code className="text-[10px] block text-center text-zinc-400">variant="ghost"</code>
              </div>
            </div>
            <div className="flex justify-center pt-2">
              <Button variant="link">Ação do Tipo Link Sem Padding</Button>
            </div>
          </div>

          {/* Tamanhos */}
          <div className="space-y-6 pt-6 border-t border-brand-bg">
            <h4 className={typography.label.default + " text-brand-primary uppercase tracking-widest text-[10px]"}>Hierarquia de Tamanhos</h4>
            <div className="flex flex-wrap items-end gap-8 justify-between p-8 bg-brand-bg/40 rounded-xl">
              <div className="flex flex-col items-center gap-4">
                <Button variant="primary" size="xs">Label XS</Button>
                <span className={typography.ui.caption}>px-2 py-1</span>
              </div>
              <div className="flex flex-col items-center gap-4">
                <Button variant="primary" size="sm">Small Action</Button>
                <span className={typography.ui.caption}>px-4 py-2</span>
              </div>
              <div className="flex flex-col items-center gap-4">
                <Button variant="primary" size="md">Default Button</Button>
                <span className={typography.ui.caption}>px-6 py-3</span>
              </div>
              <div className="flex flex-col items-center gap-4">
                <Button variant="primary" size="lg">Large Hero Action</Button>
                <span className={typography.ui.caption}>px-8 py-4</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Forms e Controles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-8 bg-surface border border-brand-border rounded-xl space-y-6 shadow-sm">
          <h3 className={typography.label.subtle + " border-b border-brand-bg pb-4 text-brand-dark dark:text-white"}>Input Controls</h3>
          <div className="space-y-4">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-text-muted" size={18} />
              <input 
                type="text" 
                placeholder="Pesquisar registros..." 
                className={`w-full pl-12 pr-4 py-3.5 bg-brand-bg border border-brand-border rounded-xl outline-none focus:bg-surface focus:border-brand-primary transition-all ${typography.ui.input}`}
              />
            </div>
            <div className="flex gap-3">
              <select className={`flex-1 px-4 py-3.5 bg-brand-bg border border-brand-border rounded-xl outline-none focus:bg-surface focus:border-brand-primary transition-all ${typography.ui.input}`}>
                <option>Filtrar por data</option>
                <option>Mais recentes</option>
              </select>
              <div className="w-14 h-14 bg-brand-primary text-white rounded-xl flex items-center justify-center cursor-pointer transition-all active:scale-95 shadow-none">
                <Plus size={28} />
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 bg-brand-secondary rounded-xl text-white flex flex-col justify-between group shadow-sm">
           <div>
              <div className="text-brand-primary mb-6">
                <Smartphone size={32} />
              </div>
              <h3 className={typography.inverse.heading.h4 + " mb-2"}>Configurações de Layout</h3>
              <p className={typography.inverse.body.sm + " mb-8"}>Todos os inputs e botões mantém a proporção áurea de espaçamento interno para toque.</p>
           </div>
           <Button variant="outline" className="w-full text-white border-zinc-700 hover:bg-zinc-800">Acessar Painel</Button>
        </div>
      </div>
    </div>
  </motion.div>
);

const LayoutSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
    <SectionHeader 
      title="Layout & Estruturas" 
      subtitle="Modelos de organização de dados e grids de interface."
      anchor="layout"
    />
    
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="p-4 bg-surface border border-brand-border rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h4 className={typography.heading.h4}>Fluxos Recentes</h4>
            <Button variant="ghost" size="sm" className="px-2 py-1">Ver todos</Button>
          </div>
          <div className="space-y-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-brand-bg border border-transparent hover:border-brand-border transition-all cursor-pointer">
                <div className="text-brand-primary">
                  <Zap size={20} strokeWidth={1.5} />
                </div>
                <div className="flex-1">
                  <p className={typography.ui.table}>Automação #{i}</p>
                  <p className={typography.ui.caption}>2h atrás</p>
                </div>
                <ChevronRight size={14} className="text-zinc-300" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <div className="p-5 bg-brand-secondary text-white rounded-xl flex flex-col justify-between h-full min-h-[220px]">
          <div>
            <div className="text-brand-primary mb-4">
              <Sparkles size={24} strokeWidth={1.5} />
            </div>
            <h4 className={typography.inverse.display.feature + " mb-1"}>Plano Pro</h4>
            <p className={typography.inverse.label.subtle}>85% do limite utilizado.</p>
          </div>
          <Button variant="primary" className="w-full h-8 px-2 py-1">Upgrade</Button>
        </div>
      </div>
    </div>
  </motion.div>
);

const UXSection = () => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
    <SectionHeader 
      title="Diretrizes de UX" 
      subtitle="Nossa experiência de usuário deve ser previsível, útil e rápida."
      anchor="ux"
    />
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-surface p-6 border border-brand-border rounded-xl space-y-6">
        <div className="flex items-center gap-3 text-brand-success">
          <CheckCircle2 size={24} />
          <h4 className={typography.heading.h3 + " text-brand-success"}>Melhores Práticas</h4>
        </div>
        <ul className="space-y-4">
          <li className="flex gap-3">
            <div className={"w-6 h-6 rounded-full bg-brand-bg flex items-center justify-center shrink-0 " + typography.label.subtle}>01</div>
            <p className={typography.body.sm}>Nunca deixe o usuário sem feedback visual após um clique.</p>
          </li>
          <li className="flex gap-3">
            <div className={"w-6 h-6 rounded-full bg-brand-bg flex items-center justify-center shrink-0 " + typography.label.subtle}>02</div>
            <p className={typography.body.sm}>Agrupe informações relacionadas em cards visivelmente separados.</p>
          </li>
          <li className="flex gap-3 text-brand-primary">
            <div className={"w-6 h-6 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 " + typography.label.subtle}>03</div>
            <p className={typography.body.sm}>Proibição Total: Nunca utilize fundos (backgrounds) coloridos atrás de ícones isolados.</p>
          </li>
          <li className="flex gap-3 text-brand-primary">
            <div className={"w-6 h-6 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 " + typography.label.subtle}>04</div>
            <p className={typography.body.sm}>Flat Design Puro: É estritamente proibido o uso de qualquer tipo de sombra (box-shadow) em botões, cards ou menus.</p>
          </li>
          <li className="flex gap-3 text-brand-primary">
            <div className={"w-6 h-6 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 " + typography.label.subtle}>05</div>
            <p className={typography.body.sm}>Contraste Máximo: Itens com background escuro (ex: Azul Carvão) devem obrigatoriamente utilizar fontes na cor Branca para legibilidade.</p>
          </li>
          <li className="flex gap-3 text-brand-primary">
            <div className={"w-6 h-6 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 " + typography.label.subtle}>06</div>
            <p className={typography.body.sm}>Escala Typo Shadcn: Padronize o UI Text em 14px (text-sm) e Headings em escala progressiva (H1: 48px, H2: 30px, H1: 24px).</p>
          </li>
          <li className="flex gap-3 text-brand-primary">
            <div className={"w-6 h-6 rounded-full bg-brand-primary/10 flex items-center justify-center shrink-0 " + typography.label.subtle}>07</div>
            <p className={typography.body.sm}>Tokens de Micro-Tipografia: Aplique obrigatoriamente tracking-tight e leading-tight para Headings e font-medium para elementos de controle UI.</p>
          </li>
        </ul>
      </div>
      
      <div className="bg-surface p-8 border border-brand-border rounded-xl flex flex-col justify-center items-center text-center space-y-4">
        <div className="text-brand-primary mb-2">
          <Smartphone size={56} strokeWidth={1.5} />
        </div>
        <h4 className={typography.heading.h3}>100% Responsivo</h4>
        <p className={typography.body.sm + " max-w-xs text-center"}>
          O MyChatCRM é desenhado para funcionar de forma fluida em desktops, tablets e dispositivos móveis, sem perda de funcionalidade.
        </p>
      </div>
    </div>
  </motion.div>
);

// --- Navigation Layout ---

export default function App() {
  const [activeSection, setActiveSection] = useState('introduction');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('theme');
      return savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return false;
  });
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Apply dark mode class
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Sync sidebar with screen size
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) setIsSidebarOpen(false);
      else setIsSidebarOpen(true);
    };
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const changeSection = (id: string) => {
    setActiveSection(id);
    if (window.innerWidth < 1024) setIsSidebarOpen(false);
    
    // Scroll to top of content
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="flex h-screen bg-brand-bg font-sans text-brand-text selection:bg-brand-primary/10 overflow-hidden">
      
      {/* Sidebar - Fixed Documentation Style */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -288 }}
            animate={{ x: 0 }}
            exit={{ x: -288 }}
            className="fixed inset-y-0 left-0 w-72 lg:w-64 bg-brand-bg border-r border-brand-border z-50 flex flex-col lg:relative lg:translate-x-0 shrink-0 select-none shadow-none"
          >
            {/* Header */}
            <div className="h-[3.5rem] px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-brand-secondary text-brand-primary flex items-center justify-center font-black text-lg shrink-0 dark:bg-zinc-800">M</div>
                <div className="min-w-0 flex flex-col">
                  <h2 className={typography.ui.sidebar + " text-brand-dark dark:text-white truncate"}>MyChatCRM</h2>
                  <span className={typography.label.subtle + " truncate lowercase"}>v1.0.0 alpha</span>
                </div>
              </div>
              <button 
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-1.5 rounded-xl hover:bg-white/60 dark:hover:bg-zinc-800 text-brand-text-muted transition-colors"
                title={isDarkMode ? "Modo Claro" : "Modo Escuro"}
              >
                {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
              </button>
            </div>

            {/* Search */}
            <div className="px-2 mb-2">
              <div className="relative group/search">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-text-muted" size={14} />
                <input 
                  type="text" 
                  placeholder="Pesquisar..." 
                  className={typography.ui.input + " w-full h-8 pl-8 pr-3 bg-white/50 dark:bg-zinc-900 dark:border-zinc-800 border border-brand-border rounded-xl outline-none focus:bg-white dark:focus:bg-zinc-800 focus:border-brand-primary/50 transition-all placeholder:text-brand-text-muted/60 dark:text-white"}
                />
              </div>
            </div>

            {/* Navigation Groups */}
            <div className="flex-1 overflow-y-auto px-2 pb-4 pt-1 space-y-4">
              {MENU_GROUPS.map((group) => (
                <div key={group.label} className="space-y-0.5">
                  <div className="h-8 px-2 flex items-center text-brand-text-muted">
                    <span className={typography.label.subtle}>{group.label}</span>
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => changeSection(item.id)}
                      className={`w-full h-8 flex items-center gap-2 px-2 rounded-xl transition-all duration-200 group relative ${
                        activeSection === item.id 
                          ? 'bg-white text-brand-primary border-brand-border border dark:bg-zinc-900 dark:border-zinc-900' 
                          : 'text-brand-text-muted hover:bg-white/60 dark:hover:bg-zinc-900 hover:text-brand-dark dark:hover:text-white border border-transparent'
                      }`}
                    >
                      <item.icon size={16} className={activeSection === item.id ? 'text-brand-primary' : 'text-brand-text-muted group-hover:text-brand-dark dark:group-hover:text-white'} />
                      <span className={typography.ui.sidebar + " truncate"}>{item.name}</span>
                      {activeSection === item.id && (
                        <motion.div layoutId="nav-dot" className="ml-auto w-1 h-3 rounded-full bg-brand-primary" />
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-brand-border mt-auto">
              <div className="w-full h-12 px-2 flex items-center gap-3 rounded-xl hover:bg-white/60 transition-colors cursor-pointer group">
                <div className="w-8 h-8 rounded-full border border-brand-border bg-white overflow-hidden shrink-0">
                  <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Renato" alt="Profile" className="w-full h-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={typography.label.default + " truncate dark:text-white"}>Renato Lagares</p>
                  <p className={typography.ui.caption + " truncate"}>renato@mychatcrm.com</p>
                </div>
                <Settings size={14} className="text-brand-text-muted group-hover:text-brand-dark dark:group-hover:text-white" />
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        
        {/* Top Navbar */}
        <nav className="h-12 border-b border-brand-border bg-white/80 dark:bg-black/80 backdrop-blur-md flex items-center justify-between px-3 shrink-0 z-40">
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1 hover:bg-brand-bg dark:hover:bg-zinc-900 rounded-xl text-brand-text-muted transition-colors"
            >
              <Menu size={18} />
            </button>
            <div className="hidden sm:block">
              <div className={"flex items-center gap-2 " + typography.ui.overline}>
                <span>Docs</span>
                <ChevronRight size={8} />
                <span className="text-brand-dark dark:text-white font-bold truncate">
                   {MENU_ITEMS.find(m => m.id === activeSection)?.name}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center bg-brand-bg dark:bg-zinc-900 rounded-xl px-2.5 py-1 border border-brand-border dark:border-zinc-800 h-8">
              <Search size={12} className="text-brand-text-muted mr-1.5" />
              <input type="text" placeholder="Search..." className={typography.ui.input + " bg-transparent border-none outline-none w-24 focus:w-36 transition-all dark:text-white"} />
              <span className={typography.ui.code + " bg-white dark:bg-zinc-800 border border-brand-border dark:border-zinc-700 px-1 rounded text-brand-text-muted ml-1.5 leading-none"}>⌘K</span>
            </div>
            <button className="relative p-1.5 text-brand-text-muted hover:text-brand-primary transition-colors">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1 h-1 bg-brand-primary rounded-full" />
            </button>
            <Button variant="primary" size="sm" className="hidden lg:flex h-8">Deploy</Button>
          </div>
        </nav>

        {/* Content Viewport */}
        <div 
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto scroll-smooth flex flex-col"
        >
          <div className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8 space-y-12 pb-16">
            
            {activeSection === 'introduction' && <IntroductionSection />}
            {activeSection === 'foundations' && <FoundationsSection />}
            {activeSection === 'colors' && <ColorsSection />}
            {activeSection === 'typography' && <TypographySection />}
            {activeSection === 'components' && <ComponentsSection />}
            {activeSection === 'layout' && <LayoutSection />}
            {activeSection === 'ux' && <UXSection />}

            {/* Pagination style footer for Docs */}
            <div className="pt-12 border-t border-brand-border flex items-center justify-between">
              <div>
                <p className={typography.label.subtle + " mb-1"}>Previous</p>
                <button className={typography.label.default + " hover:text-brand-primary flex items-center gap-1 transition-colors dark:text-white"}>
                   Home Page
                </button>
              </div>
              <div className="text-right">
                <p className={typography.label.subtle + " mb-1"}>Next</p>
                <button className={typography.label.default + " hover:text-brand-primary flex items-center gap-1 transition-colors dark:text-white"}>
                  Design Tokens <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>

          <footer className="bg-brand-bg border-t border-brand-border p-12 text-center md:text-left">
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
              <div className="col-span-1 md:col-span-2">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-8 h-8 bg-brand-primary rounded-xl flex items-center justify-center font-black text-white text-lg">M</div>
                  <h2 className="text-xl font-bold text-brand-dark dark:text-white tracking-tight">MyChatCRM Docs</h2>
                </div>
                <p className="text-brand-text-muted text-sm max-w-sm">
                  O sistema de design definitivo para construir a próxima geração de relacionamentos inteligentes com clientes.
                </p>
              </div>
              <div>
                <h5 className={typography.label.default + " text-brand-dark dark:text-white mb-4"}>Recursos</h5>
                <ul className={"space-y-2 " + typography.ui.caption}>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">Componentes</a></li>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">Brand Assets</a></li>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">Figma Guide</a></li>
                </ul>
              </div>
              <div>
                <h5 className={typography.label.default + " text-brand-dark dark:text-white mb-4"}>Empresa</h5>
                <ul className={"space-y-2 " + typography.ui.caption}>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">About Us</a></li>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">Contact</a></li>
                  <li><a href="#" className="hover:text-brand-primary transition-colors">Legal</a></li>
                </ul>
              </div>
            </div>
          </footer>
        </div>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && window.innerWidth < 1024 && (
        <div 
          className="fixed inset-0 bg-brand-dark/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
}
