import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PageTop, PageFoot } from "./LegalLayout.js";

export function NotFound() {
  useEffect(() => {
    document.title = "Page not found · MoMo›Me";
  }, []);

  return (
    <div className="page">
      <PageTop />
      <div className="nf">
        <div className="nf-inner">
          <div className="nf-code" aria-hidden="true">4<span className="arrow">›</span>4</div>
          <h1>This page took a wrong turn</h1>
          <p>
            The page you’re after doesn’t exist or has moved. Your money is safe — nothing here affects a
            payment in progress.
          </p>
          <div className="nf-actions">
            <Link className="btn btn-primary" to="/send">Pay Mobile Money</Link>
            <Link className="btn btn-ghost" to="/">Back to home</Link>
          </div>
          <div className="nf-links">
            Looking for something? Try <Link to="/contact">Help &amp; support</Link>,{" "}
            <Link to="/terms">Terms</Link>, or <Link to="/privacy">Privacy</Link>.
          </div>
        </div>
      </div>
      <PageFoot current={null} />
    </div>
  );
}
