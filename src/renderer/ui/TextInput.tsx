import type { KeyboardEvent, Ref } from "react";

interface TextInputProps {
  autoFocus?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  ref?: Ref<HTMLInputElement>;
  value: string;
}

// アプリ全体で使う 1 行のテキスト入力欄。
export function TextInput({
  autoFocus,
  disabled,
  onChange,
  onKeyDown,
  placeholder,
  ref,
  value,
}: TextInputProps) {
  return (
    <input
      ref={ref}
      type="text"
      className="text-input"
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      value={value}
    />
  );
}
