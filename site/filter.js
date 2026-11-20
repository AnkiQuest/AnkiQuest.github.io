// Hides poses that do not match the search box, and sections left empty.
const input = document.getElementById("filter");
input.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  for (const section of document.querySelectorAll("main section")) {
    let shown = 0;
    for (const pose of section.querySelectorAll(".pose")) {
      const match = pose.dataset.search.includes(query);
      pose.hidden = !match;
      shown += match ? 1 : 0;
    }
    section.hidden = shown === 0;
  }
});
