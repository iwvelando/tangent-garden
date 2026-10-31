// Closes every notebook's sidebar, as isaacvelando.com closes its page. A
// new tab keeps an unsaved study in place.
export function AboutSite() {
  return (
    <p className="about-site">
      <a
        href="https://github.com/iwvelando/tangent-garden"
        target="_blank"
        rel="noopener noreferrer"
      >
        About this site
      </a>
    </p>
  );
}
