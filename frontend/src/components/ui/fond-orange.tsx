import "./fond-orange.css";

/**
 * Lumière orange animée, fixée derrière la page. À placer dans un conteneur `relative isolate` :
 * sans ce contexte d'empilement, le fond du <body> se peindrait par-dessus.
 * Les sections claires posées dessus doivent être transparentes (classe `surface-orange`).
 */
export function FondOrange() {
  return (
    <div aria-hidden className="fond-orange">
      <div className="fond-orange-base" />
      <div className="fond-orange-lueur" />
      <div className="fond-orange-traine" />
      <div className="fond-orange-grain" />
    </div>
  );
}
