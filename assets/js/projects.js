// Project list, newest first.
// Placeholder content — will be replaced by the real projects from the Instagram archive.
(function () {
  const base = [
    [2026, "Project title nine", "Venue, City", "ph-6"],
    [2026, "Project title eight", "Festival, City", "ph-7"],
    [2025, "Project title seven", "Venue, City", "ph-5"],
    [2025, "Project title six", "Theatre, City", "ph-9"],
    [2025, "Project title five", "Festival, City", "ph-4"],
    [2024, "Project title four", "Theatre, City", "ph-3"],
    [2024, "Project title three", "Gallery, City", "ph-8"],
    [2023, "Project title two", "Gallery, City", "ph-2"],
    [2022, "Project title one", "Venue, City", "ph-1"]
  ];
  const pool = ["ph-1", "ph-2", "ph-3", "ph-4", "ph-5", "ph-6", "ph-7", "ph-8", "ph-9"];
  window.PROJECTS = base.map(([year, title, place, visual], i) => ({
    slug: "project-" + String(base.length - i).padStart(2, "0"),
    year, title, place, visual,
    images: [visual, pool[(i * 4 + 2) % 9], pool[(i * 2 + 5) % 9]].slice(0, 2 + (i % 2)),
    facts: { Year: String(year), Venue: place.split(", ")[0] + " name", City: "City, Country", Commission: "Commissioner", Collaborators: "Name, Name", Photos: "Photographer name" },
    intent: "A short paragraph on the idea behind the piece: what the light does to the space, the atmosphere it was meant to create, the question it asks.",
    making: "How it was built: fixtures, sources, control, materials, the constraints of the site and the choices they forced."
  }));
})();
