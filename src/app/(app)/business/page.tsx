import { redirect } from "next/navigation";

/** Business opens on its first page, Retail stores. */
export default function BusinessPage() {
  redirect("/business/stores");
}
