import { type ChangeEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, Archive, ArrowLeft, BookOpen, Check, CircleHelp,
  Copy, Download, Edit3, FileText, Focus, Gauge, Heart, Home, Languages, Lock,
  MessageCircle, Moon, MoreHorizontal, Monitor, Pencil, Plus, Radio, RefreshCw,
  Save, Search, Settings, ShieldCheck, Sparkles, Sun, Trash2, Upload, UserRound,
  X, Zap
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

type Theme = 'light' | 'dark' | 'system';
type Mode = 'quick' | 'calm';
type Dialect = 'سعودي' | 'مصري' | 'شامي' | 'خليجي أبيض';
type SuggestionStyle = 'متوازن' | 'مباشر' | 'خفيف';
type Source = 'demo' | 'manual' | 'screen';

type PersonalityProfile = {
  id: string; name: string; description: string; warmth: number; humor: number;
  confidence: number; directness: number; playfulness: number; responseLength: 'قصير' | 'متوسط' | 'مفصل';
  emojiPreference: boolean; laughterStyle: string; preferredWords: string[]; blockedWords: string[]; locked: boolean;
};
type DialectSettings = { dialect: Dialect; strength: number; punctuation: boolean; replyLanguage: 'العربية' | 'عربي + English'; };
type Player = { id: string; name: string; lastMessage: string; lastSeen: string; interactionCount: number; mentionCount: number; focused: boolean; ignored: boolean; };
type ChatMessage = { id: string; playerId: string; playerName: string; text: string; timestamp: string; target: 'you' | 'room'; isDirect: boolean; isConflict: boolean; source: Source; };
type ReplySuggestion = { id: string; sourceMessageId: string; playerId: string; generatedText: string; style: SuggestionStyle; generatedAt: string; copiedAt?: string; favorite: boolean; };
type Session = { id: string; name: string; createdAt: string; updatedAt: string; messageCount: number; replyCount: number; };
type UserPreferences = { mode: Mode; theme: Theme; learnStyle: boolean; showTranslation: boolean; privacyCapture: boolean; compactMode: boolean; };
type Crop = { x: number; y: number; width: number; height: number; };
type CropInteraction = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const DEFAULT_CHAT_CROP: Crop = { x: 0.05, y: 0.08, width: 0.9, height: 0.53 };
const MIN_CROP_SIZE = 0.1;

function clampCrop(crop: Crop): Crop {
  const width = Math.min(1, Math.max(MIN_CROP_SIZE, crop.width));
  const height = Math.min(1, Math.max(MIN_CROP_SIZE, crop.height));
  return {
    x: Math.min(1 - width, Math.max(0, crop.x)),
    y: Math.min(1 - height, Math.max(0, crop.y)),
    width,
    height,
  };
}

function updateCropFromPointer(startCrop: Crop, interaction: CropInteraction, deltaX: number, deltaY: number): Crop {
  if (interaction === 'move') {
    return clampCrop({ ...startCrop, x: startCrop.x + deltaX, y: startCrop.y + deltaY });
  }

  const left = interaction.includes('w') ? startCrop.x + deltaX : startCrop.x;
  const right = interaction.includes('e') ? startCrop.x + startCrop.width + deltaX : startCrop.x + startCrop.width;
  const top = interaction.includes('n') ? startCrop.y + deltaY : startCrop.y;
  const bottom = interaction.includes('s') ? startCrop.y + startCrop.height + deltaY : startCrop.y + startCrop.height;
  const boundedLeft = interaction.includes('w') ? Math.min(Math.max(0, left), right - MIN_CROP_SIZE) : startCrop.x;
  const boundedRight = interaction.includes('e') ? Math.max(Math.min(1, right), boundedLeft + MIN_CROP_SIZE) : startCrop.x + startCrop.width;
  const boundedTop = interaction.includes('n') ? Math.min(Math.max(0, top), bottom - MIN_CROP_SIZE) : startCrop.y;
  const boundedBottom = interaction.includes('s') ? Math.max(Math.min(1, bottom), boundedTop + MIN_CROP_SIZE) : startCrop.y + startCrop.height;
  return clampCrop({ x: boundedLeft, y: boundedTop, width: boundedRight - boundedLeft, height: boundedBottom - boundedTop });
}

function cropLabel(crop: Crop) {
  return `${Math.round(crop.x * 100)}%, ${Math.round(crop.y * 100)}% · ${Math.round(crop.width * 100)}% × ${Math.round(crop.height * 100)}%`;
}

const FRAME_SIGNATURE_COLUMNS = 32;
const FRAME_SIGNATURE_ROWS = 18;
const FRAME_CHANGE_THRESHOLD = 7;
const FRAME_CHANGED_CELL_THRESHOLD = 3;
type FrameSignature = number[];

function createFrameSignature(context: CanvasRenderingContext2D, width: number, height: number): FrameSignature {
  const pixels = context.getImageData(0, 0, width, height).data;
  const signature: FrameSignature = [];
  for (let row = 0; row < FRAME_SIGNATURE_ROWS; row += 1) {
    const startY = Math.floor(row * height / FRAME_SIGNATURE_ROWS);
    const endY = Math.max(startY + 1, Math.floor((row + 1) * height / FRAME_SIGNATURE_ROWS));
    for (let column = 0; column < FRAME_SIGNATURE_COLUMNS; column += 1) {
      const startX = Math.floor(column * width / FRAME_SIGNATURE_COLUMNS);
      const endX = Math.max(startX + 1, Math.floor((column + 1) * width / FRAME_SIGNATURE_COLUMNS));
      let luminance = 0;
      let count = 0;
      for (let y = startY; y < Math.min(endY, height); y += 1) {
        for (let x = startX; x < Math.min(endX, width); x += 1) {
          const offset = (y * width + x) * 4;
          luminance += pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114;
          count += 1;
        }
      }
      signature.push(count ? luminance / count : 0);
    }
  }
  return signature;
}

function frameDifference(previous: FrameSignature | null, current: FrameSignature) {
  if (!previous || previous.length !== current.length) return { average: Number.POSITIVE_INFINITY, changedCells: current.length };
  let total = 0;
  let changedCells = 0;
  current.forEach((value, index) => {
    const difference = Math.abs(value - previous[index]);
    total += difference;
    if (difference >= FRAME_CHANGE_THRESHOLD) changedCells += 1;
  });
  return { average: total / current.length, changedCells };
}

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
const copyToClipboard = (text: string) => navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('clipboard-unavailable'));
const initialProfile: PersonalityProfile = {
  id: 'profile-balanced', name: 'الرفيق المتزن', description: 'ودود وواثق، يلتقط المزحة ولا يبالغ فيها.',
  warmth: 72, humor: 54, confidence: 68, directness: 52, playfulness: 48, responseLength: 'متوسط',
  emojiPreference: false, laughterStyle: 'هههه', preferredWords: ['أكيد', 'يا سلام'], blockedWords: ['غبي'], locked: false
};
const initialPlayers: Player[] = [
  { id: 'p-nour', name: 'Nour Alia', lastMessage: 'وينكم؟ الجلسة حلوة اليوم', lastSeen: ago(1), interactionCount: 8, mentionCount: 2, focused: true, ignored: false },
  { id: 'p-omar', name: 'Omar_77', lastMessage: 'خلونا نغير المكان', lastSeen: ago(3), interactionCount: 4, mentionCount: 0, focused: false, ignored: false },
  { id: 'p-lina', name: 'Lina V', lastMessage: 'ههههه لا مستحيل', lastSeen: ago(9), interactionCount: 3, mentionCount: 1, focused: false, ignored: false },
];
const initialMessages: ChatMessage[] = [
  { id: 'm-1', playerId: 'p-nour', playerName: 'Nour Alia', text: 'وينكم؟ الجلسة حلوة اليوم', timestamp: ago(1), target: 'room', isDirect: false, isConflict: false, source: 'demo' },
  { id: 'm-2', playerId: 'p-omar', playerName: 'Omar_77', text: 'خلونا نغير المكان، هذا اللوك مزدحم', timestamp: ago(3), target: 'room', isDirect: false, isConflict: false, source: 'demo' },
  { id: 'm-3', playerId: 'p-lina', playerName: 'Lina V', text: 'ههههه لا مستحيل تسوونها', timestamp: ago(9), target: 'room', isDirect: false, isConflict: false, source: 'demo' },
];
const initialSuggestions: ReplySuggestion[] = [
  { id: 's-1', sourceMessageId: 'm-1', playerId: 'p-nour', generatedText: 'إيه والله، الجو اليوم غير. وش رايكم نكمل هنا شوي؟', style: 'متوازن', generatedAt: ago(1), favorite: false },
  { id: 's-2', sourceMessageId: 'm-1', playerId: 'p-nour', generatedText: 'أنا موجود، لا تتحمسون وتخلّوني أبدأ السالفة لحالي.', style: 'مباشر', generatedAt: ago(1), favorite: false },
  { id: 's-3', sourceMessageId: 'm-1', playerId: 'p-nour', generatedText: 'حاضرين يا نجوم، بس نحتاج دخول درامي بسيط.', style: 'خفيف', generatedAt: ago(1), favorite: false },
];

const STORAGE_DB = 'avakin-copilot-local';
const STORAGE_STORE = 'key-value';

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('indexeddb-unavailable'));
      return;
    }
    const request = window.indexedDB.open(STORAGE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORAGE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  });
}

async function readStore<T>(key: string, fallback: T): Promise<T> {
  try {
    const database = await openStorage();
    return await new Promise<T>((resolve, reject) => {
      const request = database.transaction(STORAGE_STORE, 'readonly').objectStore(STORAGE_STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? fallback);
      request.onerror = () => reject(request.error ?? new Error('indexeddb-read-failed'));
    });
  } catch {
    return fallback;
  }
}

async function writeStore<T>(key: string, value: T) {
  try {
    const database = await openStorage();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(STORAGE_STORE, 'readwrite').objectStore(STORAGE_STORE).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('indexeddb-write-failed'));
    });
  } catch {
    // Local-first data remains in React state for this session if IndexedDB is unavailable.
  }
}

function usePersisted<T>(key: string, fallback: T): [T, (value: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(fallback);
  const hydrated = useRef(false);
  useEffect(() => {
    let active = true;
    void readStore(key, fallback).then((stored) => {
      if (active) {
        setValue(stored);
        hydrated.current = true;
      }
    });
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (hydrated.current) void writeStore(key, value);
  }, [key, value]);
  return [value, setValue];
}

function useCopilotStore() {
  const [preferences, setPreferences] = usePersisted<UserPreferences>('avakin.preferences', { mode: 'calm', theme: 'system', learnStyle: true, showTranslation: false, privacyCapture: true, compactMode: false });
  const [dialect, setDialect] = usePersisted<DialectSettings>('avakin.dialect', { dialect: 'خليجي أبيض', strength: 66, punctuation: true, replyLanguage: 'العربية' });
  const [profiles, setProfiles] = usePersisted<PersonalityProfile[]>('avakin.profiles', [initialProfile]);
  const [activeProfileId, setActiveProfileId] = usePersisted<string>('avakin.active-profile', initialProfile.id);
  const [players, setPlayers] = usePersisted<Player[]>('avakin.players', initialPlayers);
  const [messages, setMessages] = usePersisted<ChatMessage[]>('avakin.messages', initialMessages);
  const [suggestions, setSuggestions] = usePersisted<ReplySuggestion[]>('avakin.suggestions', initialSuggestions);
  const [sessions, setSessions] = usePersisted<Session[]>('avakin.sessions', []);
  const [history, setHistory] = usePersisted<ReplySuggestion[]>('avakin.history', []);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0];
  const addMessage = (text: string, playerId = 'p-nour', source: Source = 'manual'): ChatMessage | null => {
    const clean = text.trim();
    if (!clean) return null;
    const normalized = clean.toLocaleLowerCase().replace(/\s+/g, ' ');
    if (messages.some((message) => message.text.toLocaleLowerCase().replace(/\s+/g, ' ') === normalized)) return null;
    const player = players.find((item) => item.id === playerId) ?? players[0];
    const message: ChatMessage = { id: uid('m'), playerId: player.id, playerName: player.name, text: clean, timestamp: now(), target: 'you', isDirect: true, isConflict: /زعل|مشكلة|ليش|كذاب|غلط/i.test(clean), source };
    setMessages((old) => [...old, message]);
    setPlayers((old) => old.map((item) => item.id === player.id ? { ...item, lastMessage: clean, lastSeen: now(), interactionCount: item.interactionCount + 1 } : item));
    const generated: ReplySuggestion[] = [
      { id: uid('s'), sourceMessageId: message.id, playerId: player.id, generatedText: `فهمت عليك. خلّنا نرتبها بهدوء ونشوف وش يناسبنا.`, style: 'متوازن', generatedAt: now(), favorite: false },
      { id: uid('s'), sourceMessageId: message.id, playerId: player.id, generatedText: `وصلت الفكرة، خلّنا نكون واضحين ونمشي على اللي اتفقنا عليه.`, style: 'مباشر', generatedAt: now(), favorite: false },
      { id: uid('s'), sourceMessageId: message.id, playerId: player.id, generatedText: `أوكي، بس لا نخلي الموضوع يصير اجتماع رسمي فجأة.`, style: 'خفيف', generatedAt: now(), favorite: false },
    ];
    setSuggestions(generated);
    return message;
  };
  const toggleFavorite = (id: string) => {
    setSuggestions((old) => old.map((item) => item.id === id ? { ...item, favorite: !item.favorite } : item));
    setHistory((old) => {
      const item = suggestions.find((suggestion) => suggestion.id === id);
      if (!item) return old;
      const next = { ...item, favorite: !item.favorite };
      return old.some((entry) => entry.id === id) ? old.map((entry) => entry.id === id ? next : entry) : [next, ...old];
    });
  };
  const saveSession = (name: string) => {
    const session = { id: uid('session'), name, createdAt: now(), updatedAt: now(), messageCount: messages.length, replyCount: history.length };
    setSessions((old) => [session, ...old]);
    return session;
  };
  return { preferences, setPreferences, dialect, setDialect, profiles, setProfiles, activeProfileId, setActiveProfileId, activeProfile, players, setPlayers, messages, setMessages, suggestions, setSuggestions, history, setHistory, sessions, setSessions, addMessage, toggleFavorite, saveSession };
}

const navItems = [
  { href: '/', label: 'المساعد الحي', icon: Radio },
  { href: '/personalities', label: 'الشخصيات', icon: Sparkles },
  { href: '/history', label: 'السجل والمفضلة', icon: Archive },
  { href: '/sessions', label: 'الجلسات', icon: BookOpen },
  { href: '/settings', label: 'الإعدادات', icon: Settings },
];

function Shell({ children, preferences, onTheme }: { children: ReactNode; preferences: UserPreferences; onTheme: (theme: Theme) => void }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isActive = (href: string) => href === '/' ? location === '/' : location.startsWith(href);
  return <div className="grain min-h-[100dvh] bg-background text-foreground" dir="rtl">
    <aside className={`fixed inset-y-0 right-0 z-40 flex w-[250px] flex-col border-l border-sidebar-foreground/10 bg-sidebar px-4 py-5 text-sidebar-foreground transition-transform md:translate-x-0 ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}>
      <div className="mb-8 flex items-center gap-3 px-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground shadow-sm"><MessageCircle size={20} /></div>
        <div><div className="text-[15px] font-extrabold tracking-tight">رفيق أفاكن</div><div className="font-mono text-[10px] uppercase tracking-[.18em] text-sidebar-foreground/50">private copilot</div></div>
      </div>
      <div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.22em] text-sidebar-foreground/40">مساحتك</div>
      <nav className="space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} data-testid={`link-nav-${label}`} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold transition-colors ${isActive(href) ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground'}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === '/' && <span className="mr-auto h-2 w-2 rounded-full bg-accent" />}</Link>)}
      </nav>
      <div className="mt-auto rounded-xl border border-sidebar-foreground/10 bg-sidebar-foreground/[.05] p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold"><ShieldCheck size={15} className="text-accent" />خصوصية أولاً</div>
        <p className="text-[11px] leading-5 text-sidebar-foreground/55">لا نرسل شيئاً نيابةً عنك. النص المنسوخ هو نهاية الرحلة.</p>
        <div className="mt-3 flex gap-1">
          {(['light', 'dark', 'system'] as Theme[]).map((theme) => <button key={theme} type="button" onClick={() => onTheme(theme)} data-testid={`button-theme-${theme}`} className={`grid h-7 w-7 place-items-center rounded-md ${preferences.theme === theme ? 'bg-accent text-accent-foreground' : 'text-sidebar-foreground/50 hover:bg-sidebar-foreground/10'}`}>{theme === 'light' ? <Sun size={13} /> : theme === 'dark' ? <Moon size={13} /> : <Monitor size={13} />}</button>)}
        </div>
      </div>
    </aside>
    {mobileOpen && <button aria-label="إغلاق القائمة" type="button" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-30 bg-foreground/20 md:hidden" />}
    <main className="min-h-[100dvh] md:mr-[250px]">
      <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-md md:px-8">
        <button type="button" onClick={() => setMobileOpen(true)} data-testid="button-open-menu" className="rounded-lg p-2 hover:bg-muted md:hidden"><MoreHorizontal size={20} /></button>
        <div className="mr-auto flex items-center gap-3 text-xs text-muted-foreground md:mr-0"><span className="font-mono text-[10px]">LOCAL ONLY</span><span className="h-1.5 w-1.5 rounded-full bg-primary pulse-soft" /><span>جلسة خاصة</span></div>
        <Link href="/" data-testid="link-header-home" className="mr-3 flex items-center gap-2 text-sm font-bold md:hidden"><span>رفيق أفاكن</span><MessageCircle size={17} className="text-primary" /></Link>
      </header>
      <div className="mx-auto max-w-[1500px] p-4 md:p-8">{children}</div>
    </main>
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end"><div><div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[.2em] text-primary"><span className="h-px w-5 bg-primary" />{eyebrow}</div><h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</div>;
}

function CropSelector({ crop, onChange, disabled = false }: { crop: Crop; onChange: (crop: Crop) => void; disabled?: boolean }) {
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<{ type: CropInteraction; startX: number; startY: number; crop: Crop } | null>(null);
  const handles: Array<{ type: Exclude<CropInteraction, 'move'>; label: string }> = [
    { type: 'nw', label: 'تكبير أو تصغير من أعلى اليمين' },
    { type: 'n', label: 'تغيير الحد العلوي' },
    { type: 'ne', label: 'تكبير أو تصغير من أعلى اليسار' },
    { type: 'e', label: 'تغيير الحد الأيمن' },
    { type: 'se', label: 'تكبير أو تصغير من أسفل اليسار' },
    { type: 's', label: 'تغيير الحد السفلي' },
    { type: 'sw', label: 'تكبير أو تصغير من أسفل اليمين' },
    { type: 'w', label: 'تغيير الحد الأيسر' },
  ];
  const getRelativePoint = (event: PointerEvent) => {
    const bounds = selectorRef.current?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
      y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const beginInteraction = (event: PointerEvent, type: CropInteraction) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = getRelativePoint(event);
    interactionRef.current = { type, startX: point.x, startY: point.y, crop };
    selectorRef.current?.setPointerCapture(event.pointerId);
  };
  const updateInteraction = (event: PointerEvent) => {
    const interaction = interactionRef.current;
    if (!interaction) return;
    event.preventDefault();
    const point = getRelativePoint(event);
    onChange(updateCropFromPointer(interaction.crop, interaction.type, point.x - interaction.startX, point.y - interaction.startY));
  };
  const endInteraction = (event: PointerEvent) => {
    if (!interactionRef.current) return;
    if (selectorRef.current?.hasPointerCapture(event.pointerId)) selectorRef.current.releasePointerCapture(event.pointerId);
    interactionRef.current = null;
  };
  return <div ref={selectorRef} className={`absolute inset-0 select-none ${disabled ? '' : 'touch-none'}`} onPointerMove={updateInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction}>
    <div
      className={`crop-selection absolute ${disabled ? '' : 'cursor-move'}`}
      style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }}
      onPointerDown={(event) => beginInteraction(event, 'move')}
      data-testid="crop-selection"
      aria-label="منطقة الدردشة المحددة"
    >
      <span className="crop-selection-label">CHAT REGION</span>
      {!disabled && handles.map(({ type, label }) => <button key={type} type="button" aria-label={label} className={`crop-handle crop-handle-${type}`} onPointerDown={(event) => beginInteraction(event, type)} />)}
    </div>
  </div>;
}

function StatusPill({ children, tone = 'teal' }: { children: ReactNode; tone?: 'teal' | 'amber' | 'muted' }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone === 'teal' ? 'bg-primary/10 text-primary' : tone === 'amber' ? 'bg-accent/20 text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>{tone === 'teal' && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}{children}</span>;
}

function LiveAssistant({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  const { messages, players, suggestions, preferences, setPreferences, addMessage, setPlayers, toggleFavorite, setSuggestions, activeProfile, dialect } = store;
  const [captureState, setCaptureState] = useState<'idle' | 'requesting' | 'capturing' | 'denied' | 'ended'>('idle');
  const [ocrState, setOcrState] = useState<'idle' | 'watching' | 'reading' | 'unavailable'>('idle');
  const [aiState, setAiState] = useState<'ready' | 'working' | 'paused'>('ready');
  const [calibrated, setCalibrated] = useState(false);
  const [chatCrop, setChatCrop] = useState<Crop>(DEFAULT_CHAT_CROP);
  const [calibrationDraft, setCalibrationDraft] = useState<Crop>(DEFAULT_CHAT_CROP);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [notice, setNotice] = useState('');
  const [focusedId, setFocusedId] = useState(players.find((player) => player.focused)?.id ?? players[0]?.id);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastFrameSignature = useRef<FrameSignature | null>(null);
  const frameBusy = useRef(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const ocrWorkerRef = useRef<{ recognize: (image: Blob | HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null>(null);
  const addMessageRef = useRef(addMessage);
  const requestAiRef = useRef<(message: ChatMessage) => Promise<void>>(async () => undefined);
  const ocrRef = useRef<(image: Blob | HTMLCanvasElement) => Promise<string>>(async () => '');
  const focusedPlayer = players.find((player) => player.id === focusedId) ?? players[0];
  const latestMessages = messages.slice(-5);
  const requestAi = async (message: ChatMessage) => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiState('working');
    try {
      const response = await fetch('/api/gemini/generate-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: message.text,
          recentMessages: [...messages.slice(-7).map((item) => `${item.playerName}: ${item.text}`), `${message.playerName}: ${message.text}`],
          dialect: dialect.dialect,
          dialectStrength: dialect.strength,
          mode: preferences.mode,
          personality: {
            name: activeProfile?.name ?? initialProfile.name,
            description: activeProfile?.description ?? initialProfile.description,
            warmth: activeProfile?.warmth ?? initialProfile.warmth,
            humor: activeProfile?.humor ?? initialProfile.humor,
            confidence: activeProfile?.confidence ?? initialProfile.confidence,
            directness: activeProfile?.directness ?? initialProfile.directness,
            playfulness: activeProfile?.playfulness ?? initialProfile.playfulness,
            responseLength: activeProfile?.responseLength ?? initialProfile.responseLength,
            preferredWords: activeProfile?.preferredWords ?? initialProfile.preferredWords,
            blockedWords: activeProfile?.blockedWords ?? initialProfile.blockedWords,
          },
        }),
      });
      const payload = await response.json() as { error?: string; suggestions?: Array<{ text: string; style: SuggestionStyle }> };
      if (!response.ok || !payload.suggestions?.length) {
        if (!controller.signal.aborted) {
          setAiState('paused');
          setNotice(payload.error ?? 'تعذر الوصول للذكاء الاصطناعي. الردود المحلية ما زالت متاحة.');
        }
        return;
      }
      if (controller.signal.aborted) return;
      setSuggestions(payload.suggestions.map((item, index) => ({
        id: uid('ai'),
        sourceMessageId: message.id,
        playerId: message.playerId,
        generatedText: item.text,
        style: item.style ?? (['متوازن', 'مباشر', 'خفيف'] as const)[index],
        generatedAt: now(),
        favorite: false,
      })));
      setAiState('ready');
    } catch {
      if (!controller.signal.aborted) {
        setAiState('paused');
        setNotice('تعذر الاتصال بالذكاء الاصطناعي. الردود المحلية ما زالت متاحة.');
      }
    }
  };
  const runOcr = async (image: Blob | HTMLCanvasElement) => {
    if (frameBusy.current) return '';
    frameBusy.current = true;
    setOcrState('reading');
    try {
      if (!ocrWorkerRef.current) {
        const { createWorker } = await import('tesseract.js');
        ocrWorkerRef.current = await createWorker('ara') as unknown as NonNullable<typeof ocrWorkerRef.current>;
      }
      const result = await ocrWorkerRef.current.recognize(image);
      return result.data.text.replace(/\s+/g, ' ').trim();
    } catch {
      setOcrState('unavailable');
      setNotice('تعذر تشغيل القراءة المحلية. يمكنك إدخال نص الرسالة يدوياً.');
      return '';
    } finally {
      frameBusy.current = false;
      setOcrState(captureState === 'capturing' && calibrated ? 'watching' : 'idle');
    }
  };
  addMessageRef.current = addMessage;
  requestAiRef.current = requestAi;
  ocrRef.current = runOcr;
  const stopCapture = () => {
    aiAbortRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    lastFrameSignature.current = null;
    setChatCrop(DEFAULT_CHAT_CROP);
    setCalibrationDraft(DEFAULT_CHAT_CROP);
    setCalibrated(false);
    setCalibrationOpen(false);
    setCaptureState('idle');
    setOcrState('idle');
    setNotice('تم إيقاف الالتقاط وتنظيف المصدر من الذاكرة.');
  };
  const startCapture = async () => {
    if (!preferences.privacyCapture) { setNotice('التقاط الشاشة موقوف من الإعدادات. فعّله أولاً إذا أردت استخدام المشاركة.'); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { setCaptureState('denied'); setNotice('المتصفح لا يدعم مشاركة الشاشة. استخدم الإدخال اليدوي حالياً.'); return; }
    setCaptureState('requesting'); setNotice('');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setCaptureState('capturing');
      setOcrState(calibrated ? 'watching' : 'idle');
      setNotice('الشاشة متصلة. حدد منطقة الدردشة لبدء القراءة المحلية.');
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        lastFrameSignature.current = null;
        setChatCrop(DEFAULT_CHAT_CROP);
        setCalibrationDraft(DEFAULT_CHAT_CROP);
        setCalibrated(false);
        setCalibrationOpen(false);
        setCaptureState('ended');
        setOcrState('idle');
        setNotice('انتهت مشاركة الشاشة. لم يتم حفظ أي لقطة.');
      });
    } catch { setCaptureState('denied'); setNotice('لم يتم السماح بمشاركة الشاشة. لا مشكلة — اكتب الرسالة يدوياً أو استخدم صورة.'); }
  };
  const openCalibration = () => { setCalibrationDraft(chatCrop); setCalibrationOpen(true); };
  const cancelCalibration = () => { setCalibrationDraft(chatCrop); setCalibrationOpen(false); };
  const saveCalibration = () => {
    if (captureState !== 'capturing') {
      setNotice('ابدأ مشاركة الشاشة أولاً حتى تحدد منطقة حقيقية من المعاينة.');
      return;
    }
    setChatCrop(clampCrop(calibrationDraft));
    setCalibrated(true);
    setCalibrationOpen(false);
    setOcrState('watching');
    lastFrameSignature.current = null;
    setNotice('تم حفظ منطقة الدردشة لهذه الجلسة فقط. تتم مقارنة التغيّر وقراءة OCR محلياً عند الحاجة.');
  };
  const submitManual = () => {
    const accepted = addMessage(manualText, focusedId, 'manual');
    if (accepted) {
      setManualText('');
      setNotice('تمت إضافة الرسالة وتحضير 3 ردود مختلفة.');
      void requestAi(accepted);
    } else if (manualText.trim()) setNotice('هذه الرسالة موجودة مسبقاً أو فارغة.');
  };
  const handleScreenshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const text = await runOcr(file);
    if (!text) return;
    const accepted = addMessage(text, focusedId, 'screen');
    if (accepted) {
      setNotice('تمت قراءة الصورة محلياً وإضافة الرسالة. لا تغادر الصورة جهازك.');
      void requestAi(accepted);
    } else {
      setNotice('هذه الرسالة موجودة مسبقاً.');
    }
  };
  useEffect(() => {
    if (captureState !== 'capturing' || !calibrated) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    const timer = window.setInterval(async () => {
      if (frameBusy.current || video.readyState < 2) return;
      canvas.width = 640;
       const sourceWidth = video.videoWidth || 640;
       const sourceHeight = video.videoHeight || 360;
       const sourceX = Math.round(sourceWidth * chatCrop.x);
       const sourceY = Math.round(sourceHeight * chatCrop.y);
       const sourceCropWidth = Math.min(sourceWidth - sourceX, Math.max(1, Math.round(sourceWidth * chatCrop.width)));
       const sourceCropHeight = Math.min(sourceHeight - sourceY, Math.max(1, Math.round(sourceHeight * chatCrop.height)));
       canvas.height = Math.max(1, Math.round(canvas.width * sourceCropHeight / sourceCropWidth));
       context.drawImage(video, sourceX, sourceY, sourceCropWidth, sourceCropHeight, 0, 0, canvas.width, canvas.height);
      const signature = createFrameSignature(context, canvas.width, canvas.height);
      const difference = frameDifference(lastFrameSignature.current, signature);
      lastFrameSignature.current = signature;
      if (difference.average < FRAME_CHANGE_THRESHOLD || difference.changedCells < FRAME_CHANGED_CELL_THRESHOLD) {
        setOcrState('watching');
        return;
      }
      const text = await ocrRef.current(canvas);
      if (!text) return;
      const accepted = addMessageRef.current(text, focusedId, 'screen');
      if (accepted) void requestAiRef.current(accepted);
    }, 1000);
    return () => window.clearInterval(timer);
   }, [captureState, calibrated, chatCrop, focusedId]);
  useEffect(() => () => {
    aiAbortRef.current?.abort();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void ocrWorkerRef.current?.terminate();
  }, []);
  const focus = (id: string) => { setFocusedId(id); setPlayers((old) => old.map((player) => ({ ...player, focused: player.id === id }))); };
  const modeLabel = preferences.mode === 'quick' ? 'سريع' : 'هادئ';
  return <div className="space-y-5">
    <canvas ref={canvasRef} className="hidden" />
    <PageHeading eyebrow="live workspace / 01" title="المساعد الحي" description="خلّك داخل اللحظة. نقرأ ما تختاره، نفهم السياق، ونترك لك القرار الأخير." action={<div className="flex items-center gap-2"><StatusPill>{modeLabel} mode</StatusPill><StatusPill tone="muted">العربية · {dialect.dialect}</StatusPill></div>} />
    {notice && <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-primary rise"><span>{notice}</span><button type="button" onClick={() => setNotice('')} data-testid="button-dismiss-notice"><X size={14} /></button></div>}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="min-w-0 space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="absolute left-0 top-0 h-24 w-24 rounded-full bg-accent/10 blur-2xl" />
            <div className="relative flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><Activity size={15} />مصدر المحادثة</div><h2 className="text-lg font-extrabold">مشاركة نافذة أفاكن</h2><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">لا نستخدم الكاميرا. لا تُحفظ الصور. المشاركة تبقى حتى تضغط إيقاف.</p></div><div className={`grid h-11 w-11 place-items-center rounded-xl ${captureState === 'capturing' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}><Monitor size={20} /></div></div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {captureState === 'capturing' ? <button type="button" onClick={stopCapture} data-testid="button-stop-capture" className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2.5 text-xs font-bold text-destructive-foreground"><X size={15} />إيقاف الالتقاط</button> : <button type="button" disabled={captureState === 'requesting'} onClick={startCapture} data-testid="button-start-capture" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-60">{captureState === 'requesting' ? <RefreshCw size={15} className="animate-spin" /> : <Radio size={15} />}{captureState === 'requesting' ? 'بانتظار الإذن…' : 'ابدأ مشاركة الشاشة'}</button>}
               <button type="button" onClick={() => document.getElementById('chat-image-input')?.click()} data-testid="button-screenshot-fallback" className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-xs font-bold hover:bg-muted"><FileText size={15} />قراءة صورة محلياً</button>
               <input id="chat-image-input" type="file" accept="image/*" className="hidden" onChange={handleScreenshot} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${captureState === 'capturing' ? 'bg-primary' : captureState === 'denied' || captureState === 'ended' ? 'bg-accent' : 'bg-muted-foreground/40'}`} />الشاشة: {captureState === 'capturing' ? 'متصلة' : captureState === 'denied' ? 'مرفوضة' : captureState === 'ended' ? 'انتهت' : 'غير متصلة'}</span><span>الشات: {calibrated ? 'جاهز' : 'غير محدد'}</span><span>OCR: {ocrState === 'reading' ? 'يقرأ' : ocrState === 'unavailable' ? 'غير متاح' : ocrState === 'watching' ? 'يراقب التغيّر' : 'متوقف'}</span><span>AI: {aiState === 'working' ? 'يحلل' : aiState === 'paused' ? 'متوقف مؤقتاً' : 'جاهز'}</span></div>
          </div>
           <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
            <div className="flex items-center justify-between"><div><div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><Focus size={15} />معايرة سريعة</div><h2 className="text-lg font-extrabold">حدد فقاعة الدردشة</h2></div><StatusPill tone={calibrated ? 'teal' : 'muted'}>{calibrated ? 'تم التحديد' : 'مطلوب مرة واحدة'}</StatusPill></div>
             <div className={`mt-5 overflow-hidden rounded-xl border ${calibrationOpen ? 'border-primary/40 bg-background' : 'border-border bg-muted/50'}`}>
               <div className={calibrationOpen ? 'p-3' : 'hidden'}>
                 <div className="mb-3 flex items-start justify-between gap-3">
                   <div><p className="text-xs font-bold">اسحب الإطار فوق رسائل الشات</p><p className="mt-1 text-[10px] leading-5 text-muted-foreground">حرّك الإطار من داخله أو استخدم المقابض لتغيير حجمه.</p></div>
                   <button type="button" onClick={cancelCalibration} data-testid="button-cancel-calibration" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="إغلاق المعايرة"><X size={15} /></button>
                 </div>
                 <div className="relative aspect-video overflow-hidden rounded-lg bg-slate-950">
                  <video ref={videoRef} data-testid="capture-preview-video" className={`absolute inset-0 h-full w-full object-fill ${captureState === 'capturing' ? '' : 'hidden'}`} muted playsInline />
                   {captureState === 'capturing' ? <CropSelector crop={calibrationDraft} onChange={setCalibrationDraft} /> : <div className="absolute inset-0 grid place-items-center p-6 text-center text-xs text-white/75"><div><Monitor size={22} className="mx-auto mb-2 text-accent" /><p className="font-bold text-white">المعاينة تظهر بعد بدء مشاركة الشاشة</p><p className="mt-1 text-[10px] leading-5">ابدأ المشاركة ثم افتح المعايرة لتحديد الشات بدقة.</p></div></div>}
                 </div>
                 <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                   <span className="font-mono text-[10px] text-muted-foreground" data-testid="text-crop-coordinates">{cropLabel(calibrationDraft)}</span>
                   <button type="button" onClick={saveCalibration} disabled={captureState !== 'capturing'} data-testid="button-save-calibration" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"><Check size={14} />حفظ المنطقة</button>
                 </div>
               </div>
               <div className={`relative h-24 ${calibrationOpen ? 'hidden' : calibrated ? 'bg-primary/5' : 'bg-muted/50'}`}><div className="absolute inset-x-7 top-4 rounded-md bg-card px-3 py-2 text-right text-[10px] shadow-sm"><span className="font-bold text-primary">Nour Alia</span><span className="mr-2 text-muted-foreground">وينكم؟ الجلسة حلوة اليوم</span></div><div className="absolute inset-x-12 bottom-3 h-px bg-accent/70" /><span className="absolute bottom-1 left-2 font-mono text-[8px] text-muted-foreground">LIVE PREVIEW</span></div>
             </div>
             <button type="button" onClick={openCalibration} data-testid="button-calibrate-chat" className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-primary hover:underline"><Focus size={14} />{calibrated ? 'إعادة تحديد المنطقة' : 'فتح معاينة وتحديد المنطقة'}</button>
             {calibrated && <p className="mt-2 text-[10px] text-muted-foreground">المنطقة الحالية: <span className="font-mono">{cropLabel(chatCrop)}</span></p>}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><div className="flex items-center gap-2"><h2 className="font-extrabold">المحادثة</h2><StatusPill>{messages.length} رسائل</StatusPill></div><p className="mt-1 text-[11px] text-muted-foreground">عرض تجريبي محلي — لا يتم إرسال أي رد تلقائياً</p></div><button type="button" onClick={() => setNotice('يمكنك حذف بيانات الجلسة من الإعدادات.')} data-testid="button-chat-help" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><CircleHelp size={17} /></button></div>
          <div className="scrollbar-thin max-h-[310px] space-y-1 overflow-y-auto p-3 md:p-5">
            {latestMessages.map((message, index) => <div key={message.id} data-testid={`message-row-${message.id}`} className={`rise delay-${Math.min(index + 1, 3)} group flex gap-3 rounded-xl px-3 py-3 ${message.playerId === focusedId ? 'bg-primary/[.06]' : 'hover:bg-muted/60'}`}><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-xs font-extrabold text-secondary-foreground">{message.playerName.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-xs"><span className="font-extrabold">{message.playerName}</span>{message.isDirect && <span className="text-primary">إليك</span>}<span className="mr-auto font-mono text-[9px] text-muted-foreground">{new Date(message.timestamp).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}</span></div><p className="bidi mt-1 text-sm leading-6">{message.text}</p></div></div>)}
          </div>
          <div className="border-t border-border bg-muted/30 p-3 md:p-4"><div className="flex gap-2"><input value={manualText} onChange={(event) => setManualText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitManual(); }} dir="rtl" data-testid="input-manual-message" placeholder="اكتب رسالة ظهرت في الدردشة…" className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none ring-primary/30 placeholder:text-muted-foreground focus:ring-2" /><button type="button" onClick={submitManual} data-testid="button-add-manual-message" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Plus size={18} /></button></div><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><ShieldCheck size={13} className="text-primary" />إدخال يدوي آمن · يزيل الرسائل المكررة تلقائياً</div></div>
        </div>
        <Suggestions suggestions={suggestions} focusedPlayer={focusedPlayer} preferences={preferences} onCopy={(suggestion) => { copyToClipboard(suggestion.generatedText).then(() => { setSuggestions((old) => old.map((item) => item.id === suggestion.id ? { ...item, copiedAt: now() } : item)); setNotice('تم نسخ الرد. ألصقه بنفسك عندما تكون جاهزاً.'); }).catch(() => setNotice('تعذر الوصول للحافظة. حدّد النص وانسخه يدوياً.')); }} onFavorite={toggleFavorite} />
      </section>
      <aside className="space-y-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><div className="mb-1 flex items-center gap-2 text-xs font-bold text-primary"><Focus size={14} />اللاعب المركّز</div><h2 className="text-lg font-extrabold">{focusedPlayer?.name ?? 'لا يوجد'}</h2></div><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent-foreground"><UserRound size={19} /></div></div><p className="bidi rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">{focusedPlayer?.lastMessage ?? 'اختر لاعباً من القائمة'}</p><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-muted/60 p-2"><div className="font-mono text-lg font-medium">{focusedPlayer?.interactionCount ?? 0}</div><div className="text-[10px] text-muted-foreground">تفاعلات</div></div><div className="rounded-lg bg-muted/60 p-2"><div className="font-mono text-lg font-medium">{focusedPlayer?.mentionCount ?? 0}</div><div className="text-[10px] text-muted-foreground">إشارات</div></div></div></div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><h2 className="font-extrabold">في الغرفة</h2><span className="font-mono text-xs text-muted-foreground">{players.filter((p) => !p.ignored).length}</span></div><div className="space-y-1">{players.map((player) => <div key={player.id} className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-right transition-colors ${player.id === focusedId ? 'bg-primary/10' : 'hover:bg-muted'} ${player.ignored ? 'opacity-40' : ''}`}><button type="button" onClick={() => focus(player.id)} data-testid={`button-focus-player-${player.id}`} className="flex min-w-0 flex-1 items-center gap-3 text-right"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-[10px] font-extrabold">{player.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-xs font-bold"><span className="truncate">{player.name}</span>{player.id === focusedId && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}</div><div className="truncate text-[10px] text-muted-foreground">{player.lastMessage}</div></div></button><button type="button" onClick={() => setPlayers((old) => old.map((item) => item.id === player.id ? { ...item, ignored: !item.ignored } : item))} data-testid={`button-ignore-player-${player.id}`} className="rounded p-1 text-muted-foreground hover:bg-background"><X size={13} /></button></div>)}</div><button type="button" onClick={() => setNotice('يتم تجاهل رسائل هذا اللاعب في التحليل، ويمكن إعادته من هنا.')} data-testid="button-smart-ignore-info" className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground hover:text-primary"><Zap size={12} className="text-accent" />التجاهل الذكي مفعّل</button></div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center justify-between"><div><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">الشخصية الحالية</div><div className="font-extrabold">{activeProfile?.name}</div></div><Link href="/personalities" data-testid="link-edit-personality" className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Pencil size={15} /></Link></div><div className="mt-4 flex flex-wrap gap-1.5"><StatusPill tone="muted">دفء {activeProfile?.warmth}%</StatusPill><StatusPill tone="muted">{activeProfile?.responseLength}</StatusPill><StatusPill tone="muted">{dialect.dialect}</StatusPill></div></div>
      </aside>
    </div>
  </div>;
}

function Suggestions({ suggestions, focusedPlayer, preferences, onCopy, onFavorite }: { suggestions: ReplySuggestion[]; focusedPlayer?: Player; preferences: UserPreferences; onCopy: (suggestion: ReplySuggestion) => void; onFavorite: (id: string) => void }) {
  const [mode, setMode] = useState<'normal' | 'conflict' | 'ignore' | 'save'>('normal');
  const visible = suggestions.slice(0, 3);
  const labels: Record<string, string> = { متوازن: 'متوازن', مباشر: 'واضح', خفيف: 'خفيف' };
  const modePrefix: Record<typeof mode, string[]> = {
    normal: ['', '', ''],
    conflict: ['خلّنا نهدّيها شوي: ', 'خلّنا نكون واضحين بدون ما نكبر الموضوع: ', 'خلّنا نقفلها بابتسامة: '],
    ignore: ['أشوفك، بس بخلي الموضوع يمشي بهدوء. ', 'خلّنا نتركها تمر، مو كل شيء يحتاج رد. ', 'بسوي نفسي ما شفتها وأكمل يومي. '],
    save: ['ما أبي أخليها awkward، بس: ', 'نحافظ على الجو الحلو ونقول: ', 'خلّني أطلع منها بشكل لطيف: '],
  };
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div className="mb-2 flex items-center gap-2 text-xs font-bold text-primary"><Sparkles size={15} />اختيارات الرد</div><h2 className="text-lg font-extrabold">آخر 3 اقتراحات</h2><p className="mt-1 text-xs text-muted-foreground">مختلفة فعلاً، وكلها تحت سيطرتك قبل النسخ.</p></div><div className="flex rounded-lg bg-muted p-1">{[['normal', 'عادي'], ['conflict', 'تهدئة'], ['ignore', 'تجاهل'], ['save', 'حفظ ماء الوجه']].map(([key, label]) => <button key={key} type="button" onClick={() => setMode(key as typeof mode)} data-testid={`button-mode-${key}`} className={`rounded-md px-2 py-1.5 text-[10px] font-bold ${mode === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}>{label}</button>)}</div></div>
    {preferences.mode === 'quick' && <div className="mt-4 flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-[11px] text-accent-foreground"><Gauge size={14} />الوضع السريع: ردود أقصر، دون شرح إضافي.</div>}
    <div className="mt-5 space-y-2">{visible.length ? visible.map((suggestion, index) => <div key={suggestion.id} data-testid={`suggestion-card-${suggestion.id}`} className={`group flex items-start gap-3 rounded-xl border p-3 transition-colors ${index === 0 ? 'border-primary/30 bg-primary/[.035]' : 'border-border hover:border-primary/20'}`}><div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted font-mono text-[10px] text-muted-foreground">0{index + 1}</div><div className="min-w-0 flex-1"><div className="mb-1 flex items-center gap-2"><span className="text-[10px] font-bold text-primary">{labels[suggestion.style]}</span>{suggestion.copiedAt && <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Check size={11} />منسوخ</span>}</div><p className="bidi text-sm leading-6">{modePrefix[mode][index]}{suggestion.generatedText}</p></div><div className="flex shrink-0 gap-1"><button type="button" onClick={() => onFavorite(suggestion.id)} data-testid={`button-favorite-${suggestion.id}`} className={`rounded-lg p-2 ${suggestion.favorite ? 'text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}><Heart size={15} fill={suggestion.favorite ? 'currentColor' : 'none'} /></button><button type="button" onClick={() => onCopy(suggestion)} data-testid={`button-copy-${suggestion.id}`} className="rounded-lg bg-primary/10 p-2 text-primary hover:bg-primary/20"><Copy size={15} /></button></div></div>) : <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground">اكتب رسالة جديدة لنقترح عليك 3 ردود.</div>}</div>
    <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-[10px] text-muted-foreground"><span>{focusedPlayer ? `موجه إلى ${focusedPlayer.name}` : 'اختر لاعباً'}</span><span className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-primary" />لن نرسل بالنيابة عنك</span></div>
  </div>;
}

function Personalities({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  const { profiles, setProfiles, activeProfileId, setActiveProfileId } = store;
  const [editing, setEditing] = useState<PersonalityProfile | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const openEditor = (profile?: PersonalityProfile) => { const value = profile ?? { ...initialProfile, id: uid('profile'), name: '', description: '' }; setEditing(value); setDraftName(value.name); setDraftDescription(value.description); };
  const save = () => { if (!editing || !draftName.trim()) return; const next = { ...editing, name: draftName.trim(), description: draftDescription.trim() }; setProfiles((old) => old.some((item) => item.id === next.id) ? old.map((item) => item.id === next.id ? next : item) : [...old, next]); setEditing(null); };
  const duplicate = (profile: PersonalityProfile) => setProfiles((old) => [...old, { ...profile, id: uid('profile'), name: `${profile.name} — نسخة` , locked: false }]);
  return <div><PageHeading eyebrow="identity / 02" title="الشخصيات" description="اصنع نبرة تشبهك. الشخصية تغيّر الاقتراح، لا تغيّر قرارك." action={<button type="button" onClick={() => openEditor()} data-testid="button-new-personality" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground"><Plus size={15} />شخصية جديدة</button>} /><div className="grid gap-4 lg:grid-cols-2">{profiles.map((profile) => <div key={profile.id} className={`rounded-2xl border bg-card p-5 shadow-sm ${activeProfileId === profile.id ? 'border-primary/50' : 'border-border'}`}><div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><div className={`grid h-11 w-11 place-items-center rounded-xl ${activeProfileId === profile.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'}`}><Sparkles size={19} /></div><div><div className="flex items-center gap-2"><h2 className="font-extrabold">{profile.name}</h2>{profile.locked && <Lock size={13} className="text-accent-foreground" />}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{profile.description}</p></div></div><button type="button" onClick={() => openEditor(profile)} data-testid={`button-edit-profile-${profile.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Edit3 size={15} /></button></div><div className="mt-5 grid grid-cols-3 gap-2">{[['دفء', profile.warmth], ['فكاهة', profile.humor], ['وضوح', profile.directness]].map(([label, value]) => <div key={label as string} className="rounded-lg bg-muted/70 p-2"><div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{label as string}</span><span className="font-mono">{value as number}</span></div><div className="h-1 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} /></div></div>)}</div><div className="mt-5 flex items-center justify-between border-t border-border pt-4"><button type="button" onClick={() => setActiveProfileId(profile.id)} data-testid={`button-select-profile-${profile.id}`} className={`rounded-lg px-3 py-2 text-xs font-bold ${activeProfileId === profile.id ? 'bg-primary/10 text-primary' : 'border border-border hover:bg-muted'}`}>{activeProfileId === profile.id ? 'مستخدمة الآن' : 'استخدام هذه الشخصية'}</button><div className="flex gap-1"><button type="button" onClick={() => duplicate(profile)} data-testid={`button-duplicate-profile-${profile.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Copy size={14} /></button><button type="button" onClick={() => setProfiles((old) => old.map((item) => item.id === profile.id ? { ...item, locked: !item.locked } : item))} data-testid={`button-lock-profile-${profile.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Lock size={14} /></button></div></div></div>)}</div>{editing && <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4"><div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-md" dir="rtl"><div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-extrabold">{profiles.some((item) => item.id === editing.id) ? 'تعديل الشخصية' : 'شخصية جديدة'}</h2><button type="button" onClick={() => setEditing(null)} data-testid="button-close-profile-editor"><X size={18} /></button></div><label className="mb-4 block text-xs font-bold">اسم الشخصية<input value={draftName} onChange={(event) => setDraftName(event.target.value)} data-testid="input-personality-name" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="مثلاً: هادي وذكي" /></label><label className="mb-5 block text-xs font-bold">الوصف<textarea value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} data-testid="input-personality-description" className="mt-2 min-h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="كيف تحب أن تبدو ردودك؟" /></label><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} data-testid="button-cancel-profile" className="rounded-lg px-4 py-2 text-xs font-bold text-muted-foreground hover:bg-muted">إلغاء</button><button type="button" onClick={save} data-testid="button-save-profile" className="rounded-lg bg-primary px-4 py-2 text-xs font-bold text-primary-foreground"><Save size={14} className="ml-1 inline" />حفظ الشخصية</button></div></div></div>}</div>;
}

function SettingsPage({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  const { preferences, setPreferences, dialect, setDialect, messages, suggestions, profiles, setProfiles, setMessages, setSuggestions, setHistory, setPlayers, setSessions } = store;
  const [feedback, setFeedback] = useState('');
  const update = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => setPreferences((old) => ({ ...old, [key]: value }));
  const exportData = () => { const payload = { preferences, dialect, profiles, messages, suggestions }; const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rafiq-avakin-data.json'; anchor.click(); URL.revokeObjectURL(url); setFeedback('تم تجهيز نسخة بياناتك محلياً.'); };
  const clear = () => { if (window.confirm('حذف كل بيانات رفيق أفاكن من هذا المتصفح؟')) { setMessages([]); setSuggestions([]); setHistory([]); setPlayers(initialPlayers); setSessions([]); setFeedback('تم تنظيف بيانات الجلسات والردود.'); } };
  return <div><PageHeading eyebrow="control room / 05" title="الإعدادات" description="اضبط النبرة والخصوصية كما تحب. كل شيء يبقى على جهازك." />{feedback && <div className="mb-5 rounded-lg bg-primary/10 px-4 py-3 text-xs font-bold text-primary">{feedback}</div>}<div className="grid gap-5 lg:grid-cols-2"><SettingsCard icon={<Languages size={18} />} title="اللهجة واللغة"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-bold">اللهجة<select value={dialect.dialect} onChange={(event) => setDialect((old) => ({ ...old, dialect: event.target.value as Dialect }))} data-testid="select-dialect" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"><option>خليجي أبيض</option><option>سعودي</option><option>مصري</option><option>شامي</option></select></label><label className="text-xs font-bold">لغة الرد<select value={dialect.replyLanguage} onChange={(event) => setDialect((old) => ({ ...old, replyLanguage: event.target.value as DialectSettings['replyLanguage'] }))} data-testid="select-reply-language" className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm"><option>العربية</option><option>عربي + English</option></select></label></div><Range label={`قوة اللهجة ${dialect.strength}%`} value={dialect.strength} onChange={(value) => setDialect((old) => ({ ...old, strength: value }))} testId="range-dialect-strength" /><Toggle label="علامات الترقيم" description="ردود مرتبة وسهلة القراءة" checked={dialect.punctuation} onChange={(value) => setDialect((old) => ({ ...old, punctuation: value }))} testId="toggle-punctuation" /></SettingsCard><SettingsCard icon={<Zap size={18} />} title="طريقة العمل"><Toggle label="الوضع السريع" description="اقتراحات أقصر أثناء المحادثات السريعة" checked={preferences.mode === 'quick'} onChange={(value) => update('mode', value ? 'quick' : 'calm')} testId="toggle-quick-mode" /><Toggle label="التعلّم من اختياراتي" description="يستخدم المفضلة لتحسين النبرة محلياً" checked={preferences.learnStyle} onChange={(value) => update('learnStyle', value)} testId="toggle-learning" /><Toggle label="عرض الترجمة المساعدة" description="إظهار معنى مختصر عند توفره" checked={preferences.showTranslation} onChange={(value) => update('showTranslation', value)} testId="toggle-translation" /></SettingsCard><SettingsCard icon={<ShieldCheck size={18} />} title="الخصوصية"><Toggle label="السماح بالتقاط الشاشة" description="يطلب إذناً من المتصفح في كل جلسة" checked={preferences.privacyCapture} onChange={(value) => update('privacyCapture', value)} testId="toggle-privacy-capture" /><Toggle label="واجهة مضغوطة" description="مناسبة للنوافذ الجانبية الضيقة" checked={preferences.compactMode} onChange={(value) => update('compactMode', value)} testId="toggle-compact-mode" /><div className="mt-4 rounded-lg bg-muted/70 p-3 text-xs leading-5 text-muted-foreground">OCR مجاني ومحلي في المتصفح. تتم مقارنة تغيّر منطقة الشات محلياً ولا تُرسل إطارات الشاشة إلى أي خدمة.</div></SettingsCard><SettingsCard icon={<Download size={18} />} title="بياناتك"><div className="flex flex-wrap gap-2"><button type="button" onClick={exportData} data-testid="button-export-data" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted"><Download size={14} />تصدير نسخة</button><button type="button" onClick={() => document.getElementById('data-import-input')?.click()} data-testid="button-import-data" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-bold hover:bg-muted"><Upload size={14} />استيراد</button><input id="data-import-input" data-testid="input-import-data" type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)); if (data.preferences) setPreferences(data.preferences); if (data.dialect) setDialect(data.dialect); if (Array.isArray(data.profiles)) setProfiles(data.profiles); setFeedback('تم استيراد الإعدادات والشخصيات من الملف.'); } catch { setFeedback('تعذر قراءة الملف. اختر نسخة JSON صادرة من رفيق أفاكن.'); } }; reader.readAsText(file); }} /><button type="button" onClick={clear} data-testid="button-delete-session-data" className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-bold text-destructive hover:bg-destructive/5"><Trash2 size={14} />حذف بيانات الجلسة</button></div></SettingsCard></div></div>;
}
function SettingsCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) { return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6"><div className="mb-5 flex items-center gap-2 font-extrabold"><span className="text-primary">{icon}</span>{title}</div>{children}</section>; }
function Toggle({ label, description, checked, onChange, testId }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) { return <label className="mb-3 flex cursor-pointer items-center justify-between gap-4 rounded-lg p-2 hover:bg-muted/60"><div><div className="text-xs font-bold">{label}</div><div className="mt-1 text-[10px] text-muted-foreground">{description}</div></div><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId} className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-border'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-card shadow-sm transition-transform ${checked ? 'right-1' : 'right-5'}`} /></button></label>; }
function Range({ label, value, onChange, testId }: { label: string; value: number; onChange: (value: number) => void; testId: string }) { return <label className="mt-4 block text-xs font-bold">{label}<input type="range" min="0" max="100" value={value} onChange={(event) => onChange(Number(event.target.value))} data-testid={testId} className="mt-3 w-full accent-[hsl(var(--primary))]" /></label>; }

function HistoryPage({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  const { history, suggestions, toggleFavorite, setSuggestions } = store;
  const [query, setQuery] = useState('');
  const all = useMemo(() => [...history, ...suggestions.filter((suggestion) => suggestion.favorite && !history.some((item) => item.id === suggestion.id))], [history, suggestions]);
  const filtered = all.filter((item) => item.generatedText.includes(query));
  return <div><PageHeading eyebrow="memory / 03" title="السجل والمفضلة" description="كل رد اخترته يبقى في مكانه، حتى تجد نبرتك أسرع في المرة القادمة." /><div className="mb-5 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute right-3 top-2.5 text-muted-foreground" size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} data-testid="input-history-search" placeholder="ابحث في الردود…" className="w-full rounded-lg border border-border bg-card py-2.5 pr-9 pl-3 text-sm outline-none focus:ring-2 focus:ring-primary/20" /></div><StatusPill tone="muted">{filtered.length} رد محفوظ</StatusPill></div>{filtered.length ? <div className="space-y-3">{filtered.map((item) => <div key={item.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/20 text-accent-foreground"><Heart size={16} fill="currentColor" /></div><div className="min-w-0 flex-1"><p className="bidi text-sm leading-6">{item.generatedText}</p><div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span>{item.style}</span><span>·</span><span>{new Date(item.generatedAt).toLocaleDateString('ar')}</span></div></div><div className="flex gap-1"><button type="button" onClick={() => { copyToClipboard(item.generatedText).catch(() => undefined); }} data-testid={`button-history-copy-${item.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Copy size={15} /></button><button type="button" onClick={() => { toggleFavorite(item.id); setSuggestions((old) => old.map((entry) => entry.id === item.id ? { ...entry, favorite: false } : entry)); }} data-testid={`button-history-remove-${item.id}`} className="rounded-lg p-2 text-accent-foreground hover:bg-muted"><Heart size={15} fill="currentColor" /></button></div></div>)}</div> : <EmptyState icon={<Archive size={22} />} title="لا توجد ردود محفوظة بعد" description="اضغط القلب بجانب أي اقتراح ليظهر هنا." />}</div>;
}
function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) { return <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center"><div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">{icon}</div><h2 className="font-extrabold">{title}</h2><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p>{action && <div className="mt-5">{action}</div>}</div>; }

function SessionsPage({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  const { sessions, saveSession, setSessions, messages, history } = store;
  const [newName, setNewName] = useState('');
  const create = () => { saveSession(newName.trim() || `جلسة ${new Date().toLocaleDateString('ar')}`); setNewName(''); };
  return <div><PageHeading eyebrow="archives / 04" title="الجلسات" description="احفظ سياق الغرفة وأعد فتحه عندما تريد، بدون مغادرة المتصفح." action={<div className="flex gap-2"><input value={newName} onChange={(event) => setNewName(event.target.value)} data-testid="input-session-name" placeholder="اسم الجلسة" className="w-32 rounded-lg border border-border bg-card px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/20 sm:w-44" /><button type="button" onClick={create} data-testid="button-save-session" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-xs font-bold text-primary-foreground"><Save size={14} />حفظ الحالية</button></div>} /><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="الجلسات" value={sessions.length} /><Stat label="رسائل هذه الجلسة" value={messages.length} /><Stat label="ردود محفوظة" value={history.length} /><Stat label="المصدر" value="محلي" /></div>{sessions.length ? <div className="space-y-3">{sessions.map((session) => <div key={session.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-secondary-foreground"><BookOpen size={18} /></div><div className="min-w-0 flex-1"><div className="font-extrabold">{session.name}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Date(session.updatedAt).toLocaleString('ar')} · {session.messageCount} رسائل · {session.replyCount} ردود</div></div><div className="flex gap-1"><button type="button" onClick={() => setSessions((old) => old.map((item) => item.id === session.id ? { ...item, updatedAt: now() } : item))} data-testid={`button-reopen-session-${session.id}`} className="rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-muted">فتح</button><button type="button" onClick={() => { const nextName = window.prompt('اسم الجلسة', session.name); if (nextName?.trim()) setSessions((old) => old.map((item) => item.id === session.id ? { ...item, name: nextName.trim(), updatedAt: now() } : item)); }} data-testid={`button-rename-session-${session.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-muted"><Pencil size={15} /></button><button type="button" onClick={() => setSessions((old) => old.filter((item) => item.id !== session.id))} data-testid={`button-delete-session-${session.id}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={15} /></button></div></div>)}</div> : <EmptyState icon={<BookOpen size={22} />} title="لم تحفظ جلسة بعد" description="احفظ اللحظة الحالية لتعود إليها لاحقاً." action={<button type="button" onClick={create} data-testid="button-create-first-session" className="rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground">ابدأ جلسة محفوظة</button>} />}</div>;
}
function Stat({ label, value }: { label: string; value: ReactNode }) { return <div className="rounded-xl border border-border bg-card p-3"><div className="font-mono text-xl font-medium">{value}</div><div className="mt-1 text-[10px] text-muted-foreground">{label}</div></div>; }

function Welcome() {
  return <div className="grid min-h-[calc(100dvh-140px)] place-items-center py-10"><div className="max-w-3xl text-center"><div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md"><MessageCircle size={29} /></div><div className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[.28em] text-primary">a quieter way to reply</div><h1 className="text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">خلك حاضر.<br /><span className="text-primary">والرد عليك.</span></h1><p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-muted-foreground md:text-base">رفيق أفاكن يقترح لك ردوداً عربية طبيعية تحافظ على شخصيتك — من دون أن يرسل كلمة واحدة بدلاً منك.</p><div className="mx-auto mt-9 grid max-w-2xl gap-3 text-right sm:grid-cols-3">{[['01', 'اختر ما نقرأه', 'مشاركة نافذة أو إدخال يدوي.'], ['02', 'راجع 3 نبرات', 'متوازن، واضح، أو خفيف.'], ['03', 'انسخ أنت', 'القرار واللصق بيدك دائماً.']].map(([number, title, desc]) => <div key={number} className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="font-mono text-xs text-accent-foreground">{number}</div><div className="mt-3 text-sm font-extrabold">{title}</div><div className="mt-1 text-[11px] leading-5 text-muted-foreground">{desc}</div></div>)}</div><Link href="/" data-testid="link-start-copilot" className="mt-9 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-bold text-primary-foreground shadow-sm">افتح مساحة العمل <ArrowLeft size={16} /></Link><div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-foreground"><ShieldCheck size={14} className="text-primary" />بياناتك على جهازك · لا يوجد إرسال تلقائي</div></div></div>;
}

function RouterContent({ store }: { store: ReturnType<typeof useCopilotStore> }) {
  return <Switch><Route path="/welcome" component={Welcome} /><Route path="/" component={() => <LiveAssistant store={store} />} /><Route path="/personalities" component={() => <Personalities store={store} />} /><Route path="/settings" component={() => <SettingsPage store={store} />} /><Route path="/history" component={() => <HistoryPage store={store} />} /><Route path="/sessions" component={() => <SessionsPage store={store} />} /><Route component={NotFound} /></Switch>;
}

function App() {
  const store = useCopilotStore();
  useEffect(() => {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    const shouldDark = store.preferences.theme === 'dark' || (store.preferences.theme === 'system' && prefersDark);
    document.documentElement.classList.toggle('dark', shouldDark);
  }, [store.preferences.theme]);
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell preferences={store.preferences} onTheme={(theme) => store.setPreferences((old) => ({ ...old, theme }))}><ErrorBoundary resetKey={window.location.pathname}><RouterContent store={store} /></ErrorBoundary></Shell></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;