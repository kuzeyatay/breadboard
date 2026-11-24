"use client";

import dynamic from "next/dynamic";
import BrainMapSkeleton from "./brain-map-skeleton.tsx";

const BrainMapClient = dynamic(() => import("./brain-map-client.tsx"), {
  ssr: false,
  loading: () => <BrainMapSkeleton />,
});

export default function BrainMapPanel({ initialScope }: { initialScope: string }) {
  return <BrainMapClient initialScope={initialScope} />;
}
