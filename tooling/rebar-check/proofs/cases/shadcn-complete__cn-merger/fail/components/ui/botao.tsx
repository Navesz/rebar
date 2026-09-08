import { cn } from "@/lib/utils"

export function Botao({ className, ...resto }) {
  return <button className={cn("px-3 py-2", className)} {...resto} />
}
