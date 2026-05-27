# Compliance and Privacy Guidance

This project collects and updates information about public giveaway cupboards (`weggeefkastjes`). The data is useful for citizens, but it can easily touch personal data when posts include names, home addresses, photos, profiles, comments, or neighbourhood-group context.

## Non-negotiable collection rules

The automation must not:

- bypass authentication, paywalls, login walls, CAPTCHAs, or technical access controls;
- scrape private Facebook groups, private Nextdoor spaces, private WhatsApp chats, or closed community apps without explicit export permission;
- impersonate users;
- collect personal profile data beyond what is strictly necessary;
- store unnecessary names, phone numbers, profile URLs, personal photos, or comments;
- mass-message people or groups;
- repost source text in full unless permission exists.

## Permitted collection channels

Preferred channels are:

1. `weggeefkastje.nl`, subject to its technical and legal access limits;
2. public pages or public posts where automated access is allowed;
3. official APIs with proper credentials and permitted use;
4. group-admin-approved data exports;
5. volunteer-submitted tips;
6. manual copy/paste imports by someone with permission to access the source;
7. email/form submissions from local residents.

## Facebook and Nextdoor approach

Facebook and Nextdoor data should be handled as **evidence intake**, not as unrestricted scraping.

Recommended safe approaches:

- Create a submission form where residents can paste a link or text summary.
- Ask local group admins for permission to export relevant posts.
- Use official APIs only where the use case is approved.
- Store a short source summary, source platform, source URL, and timestamp instead of full personal conversations.
- Keep uncertain social reports in `needs_verification` until confirmed.

## Personal data minimisation

The system should store:

- approximate location or address hint;
- source platform;
- source URL if available;
- source timestamp;
- kastje status;
- confidence score;
- supporting evidence summary.

The system should avoid storing:

- names of private individuals;
- profile IDs;
- phone numbers;
- full post text if it contains personal details;
- full photos unless permission exists;
- comments or discussion threads unrelated to the kastje status.

## Status caution

A weggeefkastje may be located near a private home. Therefore:

- exact addresses should be treated carefully;
- low-confidence records should not be published automatically;
- newly discovered records should pass a review or confidence threshold;
- removal requests should be respected quickly;
- data freshness should be visible.

## Recommended publication model

Public export should include only:

- public display name or generated label;
- approximate location or rounded coordinates when needed;
- municipality and province;
- status;
- last verified date;
- general notes about accepted items if available.

Private admin storage may keep more detailed evidence, but only where necessary and lawful.
