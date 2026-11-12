import { poweredByHtml } from "../render/poweredBy.js";

/** A link that shows the app is built on Queria. */
export const PoweredBy = () => <span dangerouslySetInnerHTML={{ __html: poweredByHtml() }} />;
