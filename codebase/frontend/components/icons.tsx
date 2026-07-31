"use client";

/**
 * Một chỗ duy nhất khai báo icon cho toàn bộ giao diện.
 * Toàn bộ icon lấy từ lucide-react (SVG) — không dùng emoji hay ký tự đặc biệt,
 * để icon giữ đúng nét, đổi màu theo theme và đọc được bằng trình đọc màn hình.
 */
import {
  Activity,
  BarChart3,
  Bird,
  BookOpen,
  Bug,
  Cat,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock,
  Compass,
  Dog,
  DoorOpen,
  Eye,
  EyeOff,
  Flag,
  Gauge,
  GraduationCap,
  Hand,
  KeyRound,
  Landmark,
  Layers,
  Link,
  ListChecks,
  Lightbulb,
  LogOut,
  Mail,
  Meh,
  MessageCircleQuestion,
  Monitor,
  Moon,
  Pencil,
  Play,
  Plus,
  Presentation,
  Radar,
  PawPrint,
  Rabbit,
  Rocket,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  SkipForward,
  Snail,
  Sparkles,
  Square,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  Trash2,
  Turtle,
  Undo2,
  Upload,
  UserPlus,
  UserRound,
  Users,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

export const Icon = {
  brand: Landmark,
  ticket: Ticket,
  key: KeyRound,
  mail: Mail,
  person: UserRound,
  signup: UserPlus,
  mask: PawPrint,
  rocket: Rocket,
  teacher: GraduationCap,
  prev: ChevronLeft,
  next: ChevronRight,
  link: Link,
  unlink: Undo2,
  hand: Hand,
  question: CircleHelp,
  askAgain: MessageCircleQuestion,
  stop: Square,
  exit: DoorOpen,
  logout: LogOut,
  sun: Sun,
  moon: Moon,
  compass: Compass,
  send: Send,
  clock: Clock,
  people: Users,
  correct: CircleCheck,
  wrong: CircleX,
  warn: CircleAlert,
  skip: SkipForward,
  unsure: Meh,
  okay: Smile,
  sure: Zap,
  up: ThumbsUp,
  down: ThumbsDown,
  close: X,
  waiting: Clock,
  // quản trị & nội dung
  course: BookOpen,
  slides: Presentation,
  layers: Layers,
  upload: Upload,
  checkpoint: Flag,
  checklist: ListChecks,
  room: Monitor,
  chart: BarChart3,
  gauge: Gauge,
  pulse: Activity,
  radar: Radar,
  ai: Sparkles,
  idea: Lightbulb,
  shield: ShieldCheck,
  play: Play,
  add: Plus,
  edit: Pencil,
  remove: Trash2,
  settings: Settings,
  show: Eye,
  hide: EyeOff,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof Icon;

/** Avatar học viên — chọn con vật, lưu bằng khoá chữ chứ không phải emoji. */
export const AVATARS = [
  { key: "cat", label: "Mèo", icon: Cat },
  { key: "dog", label: "Chó", icon: Dog },
  { key: "rabbit", label: "Thỏ", icon: Rabbit },
  { key: "bird", label: "Chim", icon: Bird },
  { key: "turtle", label: "Rùa", icon: Turtle },
  { key: "snail", label: "Ốc sên", icon: Snail },
  { key: "bug", label: "Bọ", icon: Bug },
  { key: "paw", label: "Dấu chân", icon: PawPrint },
] as const;

export type AvatarKey = (typeof AVATARS)[number]["key"];

const AVATAR_MAP = Object.fromEntries(AVATARS.map((a) => [a.key, a])) as Record<
  string,
  (typeof AVATARS)[number]
>;

export function avatarIcon(key: string): LucideIcon {
  return AVATAR_MAP[key]?.icon ?? PawPrint;
}

export function avatarLabel(key: string): string {
  return AVATAR_MAP[key]?.label ?? "Ẩn danh";
}

/** Icon trạng thái lớp — mỗi trạng thái một icon + một tông màu. */
export const STATE_ICON: Record<string, { icon: LucideIcon; className: string }> = {
  healthy: { icon: CircleCheck, className: "text-grass" },
  stable: { icon: CircleCheck, className: "text-grass" },
  discussion_active: { icon: MessageCircleQuestion, className: "text-sky" },
  need_review: { icon: Undo2, className: "text-sky" },
  low_participation: { icon: Meh, className: "text-flame" },
  need_attention: { icon: CircleAlert, className: "text-flame" },
  high_confusion: { icon: CircleX, className: "text-cherry" },
  insufficient_data: { icon: Clock, className: "text-muted" },
};

/** Màu antd tương ứng từng trạng thái — dùng cho Tag/Alert ở khu vực giảng viên. */
export const STATE_COLOR: Record<string, string> = {
  healthy: "success",
  stable: "success",
  discussion_active: "processing",
  need_review: "processing",
  low_participation: "warning",
  need_attention: "warning",
  high_confusion: "error",
  insufficient_data: "default",
};
