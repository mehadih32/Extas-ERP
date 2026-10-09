import { usePageForm } from "@/components/accounts/form-bits";

/**
 * A Raw materials page form's state (see usePageForm), showing the server's
 * message above the buttons for every refusal: "Not enough FAB-0001 in Main
 * store" names a line the form may not show an error on.
 */
export function useMaterialsForm() {
  const form = usePageForm();
  return {
    ...form,
    general: form.error && form.error.code !== "INTERNAL" ? form.error.message : undefined,
  };
}
