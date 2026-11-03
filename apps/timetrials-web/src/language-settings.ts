import {
  PRODUCT_LANGUAGES,
  productLanguage,
  setProductLanguage,
  type ProductLanguage,
} from "./product-language.js";

export function mountLanguageSettings(root: HTMLElement): HTMLElement {
  const document = root.ownerDocument;
  const section = document.createElement("section");
  section.className = "ds-panel language-settings";
  const title = document.createElement("h3");
  title.className = "ds-title";
  title.textContent = "Language / Taal";
  const note = document.createElement("p");
  note.className = "ds-panel__note";
  note.textContent = "Choose the product language. More languages can be added without changing saved preferences.";
  const select = document.createElement("select");
  select.className = "ds-select country-settings__select";
  select.setAttribute("aria-label", "Product language");
  for (const language of PRODUCT_LANGUAGES) {
    const option = document.createElement("option");
    option.value = language.code;
    option.textContent = language.label;
    option.selected = language.code === productLanguage();
    select.append(option);
  }
  const status = document.createElement("p");
  status.className = "ds-body-s country-settings__status";
  status.setAttribute("role", "status");
  select.addEventListener("change", () => {
    setProductLanguage(select.value as ProductLanguage);
    status.textContent = select.value === "nl"
      ? "Nederlands is opgeslagen. Open een pagina opnieuw om alle teksten te verversen."
      : "English is saved. Reopen a page to refresh all text.";
  });
  section.append(title, note, select, status);
  root.append(section);
  return section;
}
