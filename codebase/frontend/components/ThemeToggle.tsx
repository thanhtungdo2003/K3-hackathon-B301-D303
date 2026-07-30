"use client";

import { useTheme } from "../app/providers";
import { BlockButton } from "./Blocks";
import { Icon } from "./icons";

export { useTheme };

export default function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <BlockButton
      square
      tone={dark ? "sun" : "plain"}
      onClick={toggle}
      aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      title={dark ? "Giao diện sáng" : "Giao diện tối"}
      icon={dark ? Icon.sun : Icon.moon}
    />
  );
}
