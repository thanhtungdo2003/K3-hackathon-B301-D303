"use client";

/** Học viên vào lớp bằng mã phòng — không tài khoản, không mật khẩu. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BlockButton, BlockInput } from "@/components/Blocks";
import ThemeToggle from "@/components/ThemeToggle";
import { AVATARS, Icon } from "@/components/icons";
import { api } from "@/lib/api";
import { useLearner } from "@/lib/store";
import { RefreshCcw, Rotate3D } from "lucide-react";

const randoneName = () => {
  const names = [
    "Panda",
    "Tiger",
    "Lion",
    "Elephant",
    "Giraffe",
    "Zebra",
    "Monkey",
    "Koala",
    "Kangaroo",
    "Penguin",
    "Dolphin",
    "Whale",
    "Shark",
    "Octopus",
    "Crab",
    "Lobster",
    "Seahorse",
    "Starfish",
    "Butterfly",
    "Bee",
    "Ladybug",
    "Dragonfly",
    "Caterpillar",
    "Snail",
    "Frog",
    "Turtle",
    "Snake",
    "Lizard",
    "Chameleon",
    "Parrot",
    "Eagle",
    "Owl",
    "Hawk",
    "Falcon",
    "Peacock",
    "Flamingo",
    "Swan",
    "Duck",
    "Goose",
    "Chicken",
    "Rooster",
    "Turkey",
    "Pigeon",
    "Seagull",
    "Crow",
    "Raven",
    "Magpie",
    "Woodpecker",
    "Hummingbird",
    "Bat",
    "Fox",
    "Wolf",
    "Bear",
    "Deer",
    "Moose",
    "Bison",
    "Buffalo",
    "Camel",
    "Horse",
    "Donkey",
    "Sheep",
    "Goat",
    "Pig",
    "Rabbit",
    "Squirrel",
    "Chipmunk",
    "Raccoon",
    "Skunk",
    "Otter",
    "Beaver",
    "Hedgehog",
    "Mole",
    "Weasel",
    "Ferret",
    "Armadillo",
    "Porcupine",
    "Opossum",
  ];
  const numRandom = Math.floor(Math.random() * 1000);
  return names[Math.floor(Math.random() * names.length)] + numRandom;
}

export default function JoinPage() {
  const router = useRouter();
  const setProfile = useLearner((s) => s.setProfile);

  const [code, setCode] = useState("");
  const [name, setName] = useState(randoneName());
  const [avatar, setAvatar] = useState<string>("paw");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ready = code.trim().length >= 4 && name.trim().length >= 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      const profile = await api.join({
        code: code.trim().toUpperCase(),
        display_name: name.trim(),
        avatar,
      });
      setProfile(profile);
      router.replace(`/learn/${profile.session_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không vào được lớp.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 py-6">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-blk border-2 border-b-4 border-line bg-surface">
            <Icon.brand aria-hidden size={22} strokeWidth={2.5} className="text-sky" />
          </span>
          <span className="text-xl font-extrabold tracking-tight">AGORA</span>
        </Link>
        <ThemeToggle />
      </header>

      <form onSubmit={submit} className="flex flex-1 flex-col justify-center gap-6">
        <div>
          <h1 className="mb-1 text-3xl font-extrabold tracking-tight">Vào lớp</h1>
          <p className="text-sm font-semibold text-muted">
            Gõ mã phòng giảng viên đọc trên lớp.
          </p>
        </div>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted">
            <Icon.ticket aria-hidden size={15} strokeWidth={2.8} />
            Mã phòng
          </span>
          <BlockInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            className="text-center text-3xl tracking-[0.4em]"
          />
        </label>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted">
            <Icon.person aria-hidden size={15} strokeWidth={2.8} />
            Tên hiển thị
          </span>
          <div className="flex gap-2">
            <BlockInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tên bạn muốn lớp thấy"
              maxLength={40}
            />
            <BlockButton
              type="button"
              tone="grape"
              onClick={() => setName(randoneName())}
              title="Tạo tên ngẫu nhiên"
            >
              <RefreshCcw aria-hidden size={20} strokeWidth={2.4} />
            </BlockButton>
          </div>
        </label>

        <div>
          <span className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-muted">
            <Icon.mask aria-hidden size={15} strokeWidth={2.8} />
            Avatar
          </span>
          <div className="grid grid-cols-4 gap-2">
            {AVATARS.map((a) => {
              const Glyph = a.icon;
              const on = avatar === a.key;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAvatar(a.key)}
                  aria-pressed={on}
                  aria-label={a.label}
                  title={a.label}
                  className={`grid h-16 place-items-center rounded-blk border-2 border-b-4 transition-transform active:translate-y-[3px] active:border-b-[1px] ${on ? "border-sky-deep bg-sky/15 text-sky" : "border-line bg-surface text-muted"
                    }`}
                >
                  <Glyph aria-hidden size={26} strokeWidth={2.4} />
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p className="flex items-start gap-2 rounded-blk border-2 border-cherry bg-surface px-4 py-3 text-sm font-bold text-cherry">
            <Icon.warn aria-hidden size={18} strokeWidth={2.6} className="mt-0.5 shrink-0" />
            {error}
          </p>
        ) : null}

        <BlockButton type="submit" tone="grass" icon={Icon.rocket} disabled={!ready || busy}>
          {busy ? "Đang vào…" : "Vào lớp"}
        </BlockButton>
      </form>

      <footer className="mt-8 text-center text-sm font-bold text-muted">
        Bạn là giảng viên?{" "}
        <Link href="/login" className="font-extrabold text-sky underline">
          Đăng nhập
        </Link>
      </footer>
    </main>
  );
}
