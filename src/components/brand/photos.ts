/** Openly licensed photos from Wikimedia Commons (ui-guideline.md section 2.2). */
export const PHOTOS = {
  pitch: {
    src: "/img/hero-pitch.jpg",
    title: "Wikimedia Hackathon 2024 10",
    author: "Asaidlo",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Wikimedia_Hackathon_2024_10.jpg",
  },
  teams: {
    src: "/img/teams-building.jpg",
    title: "Hackathon participants at Wikimania 2024",
    author: "Tulipasylvestris",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Hackathon_participants_at_Wikimania_2024.jpg",
  },
  room: {
    src: "/img/demo-room.jpg",
    title: "Day2 Indic Wikimania Hackathon 2022 10",
    author: "SSethi (WMF)",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Day2_Indic_Wikimania_Hackathon_2022_10.jpg",
  },
} as const;

export type PhotoKey = keyof typeof PHOTOS;
