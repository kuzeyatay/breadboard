"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import GardenFileViewer from "@/app/garden/garden-file-viewer";
import type { GardenFileEntry } from "@/lib/garden-files/types";
export default function StandaloneGardenFile({ initialFile }: { initialFile: GardenFileEntry }) {
  const [file, setFile] = useState(initialFile), router = useRouter();
  return <main className="h-screen"><GardenFileViewer file={file} onChanged={setFile} onClose={() => router.push(`/garden/${encodeURIComponent(file.gardenId)}`)} /></main>;
}
