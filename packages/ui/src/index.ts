/**
 * Public surface of @facilis/ui: one flat list of named exports, nothing else
 * (docs/BASE-KIT-CONTRACTS.md section 3.1). Components expose no theme props; colours, type,
 * spacing and motion come from the tokens in theme.css (D-047, D-051).
 */
export { Alert } from "./alert.tsx";
export { AuthShell } from "./auth-shell.tsx";
export { Avatar, AvatarStack } from "./avatar.tsx";
export { Badge } from "./badge.tsx";
export { Button } from "./button.tsx";
export { Card } from "./card.tsx";
export { Checkbox } from "./checkbox.tsx";
export { Combobox } from "./combobox.tsx";
export { DatePicker } from "./date-picker.tsx";
export { Dialog } from "./dialog.tsx";
export { EmptyState } from "./empty-state.tsx";
export { Field } from "./field.tsx";
export { Input } from "./input.tsx";
export { Markdown } from "./markdown.tsx";
export { MarkdownEditor } from "./markdown-editor.tsx";
export { Menu } from "./menu.tsx";
export { Page } from "./page.tsx";
export { Pagination } from "./pagination.tsx";
export { Select } from "./select.tsx";
export { Skeleton } from "./skeleton.tsx";
export { Spinner } from "./spinner.tsx";
export { StatCard } from "./stat-card.tsx";
export { Switch } from "./switch.tsx";
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "./table.tsx";
export { TableToolbar } from "./table-toolbar.tsx";
export { Tabs } from "./tabs.tsx";
export { TagPicker } from "./tag-picker.tsx";
export { Textarea } from "./textarea.tsx";
export { toast } from "./toaster-store.ts";
export { Toaster } from "./toaster.tsx";
export { TranslationsInput } from "./translations-input.tsx";
export type { Translations } from "./translations-input.tsx";
