import { redirect } from "next/navigation";

/** Office is part of Spaces now. */
export default function OfficePage() {
  redirect("/spaces");
}
