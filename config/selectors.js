const SELECTORS = {

    PROFILE: {

        ROOT: "main",

        NAME: "h2",

        PARAGRAPHS: "main p",

        COMPANY_LINKS: 'a[href*="/company/"]'

    },

    // Experience is scraped from the dedicated details route
    //   /in/<publicId>/details/experience/
    // NOT the lazy-mounted main profile page. See extractors/experience.js
    // for the root-cause explanation.
    EXPERIENCE: {

        // Anchor that precedes the experience list on the details page.
        LIST_ANCHOR: '[componentkey="profileExperienceDetails_top_anchor"]',

        // One node per company (single-role or grouped).
        ENTITY: '[componentkey^="entity-collection-item"]',

        COMPANY_LINK: 'a[href*="/company/"]',

        // Company logo carries aria-label="<Company> logo".
        LOGO: '[role="img"][aria-label$="logo"]'

    },

    COMPANY: {

        DT: "dt",

        DD: "dd",

        WEBSITE_LINK: 'a[href^="http"]'

    }

};

module.exports = SELECTORS;