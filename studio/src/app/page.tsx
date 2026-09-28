import { Suspense } from "react";
import { Studio } from "@/components/studio";

export default function HomePage() {
  return (
    <Suspense
      fallback={<div role="status" aria-label="Carregando" className="hatch-march h-3 w-48 border-2 border-ink" />}
    >
      <Studio />
    </Suspense>
  );
}
