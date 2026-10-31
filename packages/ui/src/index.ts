/**
 * Public surface of @facilis/ui: one flat list of named exports, nothing else
 * (docs/BASE-KIT-CONTRACTS.md section 3.1). Components expose no theme props; colours and
 * radii come from the role variables in theme.css (D-047).
 */
export { Alert } from "./alert.tsx";
export { Badge } from "./badge.tsx";
export { Button } from "./button.tsx";
export { Checkbox } from "./checkbox.tsx";
export { Field } from "./field.tsx";
export { Input } from "./input.tsx";
export { Select } from "./select.tsx";
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
export { Textarea } from "./textarea.tsx";
export { toast } from "./toaster-store.ts";
export { Toaster } from "./toaster.tsx";
