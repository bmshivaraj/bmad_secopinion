import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Independent Medical Second Opinions | SecOpinion",
  description: "Get a qualified specialist's written second opinion on a recommended treatment, using the reports you already have.",
};

export default function HomePage() {
  return (
    <main className="home-page">
      <header className="home-nav">
        <Link className="home-brand" href="/" aria-label="SecOpinion home">
          <span className="home-brand-mark" aria-hidden="true">S</span>
          <span>SecOpinion</span>
        </Link>
        <nav className="home-nav-links" aria-label="Main navigation">
          <a className="home-nav-link" href="#why">Why a second opinion</a>
          <a className="home-nav-link" href="#journey">The review process</a>
          <a className="home-nav-portals" href="#portals">Portals</a>
          <Link className="home-nav-cta" href="/login">Patient sign in</Link>
        </nav>
      </header>

      <section className="home-hero" aria-labelledby="home-hero-heading">
        <img
          className="home-hero-image"
          src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=2200&q=85"
          alt="A doctor reviewing medical information with a patient"
          fetchPriority="high"
        />
        <div className="home-hero-shade" aria-hidden="true" />
        <div className="home-hero-copy">
          <p className="home-eyebrow">Independent specialist review</p>
          <h1 id="home-hero-heading">Because Your Health Deserves a Second Look</h1>
          <p className="home-hero-intro">
            When surgery or major treatment is recommended, an independent Doctor can review your reports and give you a written opinion to discuss with your treating Doctor.
          </p>
          <div className="home-hero-actions">
            <Link className="home-button home-button-primary" href="/login">Patient sign in</Link>
            <a className="home-text-link" href="#why">Why SecOpinion</a>
          </div>
          <p className="home-hero-note">Not for emergencies. A second opinion supports, but does not replace, care from your treating Doctor.</p>
        </div>
        <p className="home-hero-caption">A considered decision starts with a clear view.</p>
      </section>

      <section className="home-why" id="why" aria-labelledby="home-why-heading">
        <div className="home-section-kicker">A little more clarity</div>
        <div className="home-why-copy">
          <h2 id="home-why-heading">A serious recommendation deserves time, context, and another qualified perspective.</h2>
          <p>
            Finding another specialist can mean another appointment, another fee, and repeating a story you have already told. SecOpinion lets you seek a written review remotely using the reports you have, without arranging another in-person visit just to obtain that second opinion. Your treating Doctor may still recommend an examination or follow-up care.
          </p>
        </div>
        <div className="home-benefit-list">
          <article>
            <span>01</span>
            <div>
              <h3>Start with what you have</h3>
              <p>Share your history, recommendation, scans, and reports in one case.</p>
            </div>
          </article>
          <article>
            <span>02</span>
            <div>
              <h3>Get a separate specialist view</h3>
              <p>A verified Doctor reviews the case in their declared specialty.</p>
            </div>
          </article>
          <article>
            <span>03</span>
            <div>
              <h3>Take the conversation forward</h3>
              <p>Use the written opinion to have a more informed discussion with your treating Doctor.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="home-journey" id="journey" aria-labelledby="home-journey-heading">
        <div className="home-journey-heading">
          <p className="home-section-kicker">A clear, document-first review</p>
          <h2 id="home-journey-heading">From your reports to a written opinion.</h2>
        </div>
        <ol className="home-journey-steps">
          <li><span>01</span><h3>Describe the situation</h3><p>Tell us what is happening and what has been recommended.</p></li>
          <li><span>02</span><h3>Share your records</h3><p>Upload the reports and scans you already have for specialist review.</p></li>
          <li><span>03</span><h3>Read the opinion</h3><p>Receive a written perspective and discuss your options with your treating Doctor.</p></li>
        </ol>
        <p className="home-fee-note">Standard cases have a five-day response SLA; it pauses while requested records are outstanding. Urgent cases receive expedited written review, not emergency care. Current fees are shown before payment.</p>
      </section>

      <section className="home-portals" id="portals" aria-labelledby="home-portals-heading">
        <div className="home-portals-heading">
          <div>
            <p className="home-section-kicker">Choose your way in</p>
            <h2 id="home-portals-heading">Who are you here as?</h2>
          </div>
          <p>Each portal has its own sign-in and access permissions.</p>
        </div>
        <div className="home-portal-grid">
          <article className="home-portal home-portal-patient">
            <span className="home-portal-number">01 / PATIENT</span>
            <h3>I am looking for a second opinion</h3>
            <p>Share your case and records with a verified specialist for an independent written view.</p>
            <Link className="home-portal-link" href="/login">Patient sign in <span aria-hidden="true">→</span></Link>
            <Link className="home-portal-secondary" href="/register/password">Set a password after OTP verification</Link>
          </article>
          <article className="home-portal home-portal-doctor">
            <span className="home-portal-number">02 / DOCTOR</span>
            <h3>I am a medical professional</h3>
            <p>Review cases within your specialties and share your expertise through a written opinion.</p>
            <Link className="home-portal-link" href="/doctors/login">Doctor sign in <span aria-hidden="true">→</span></Link>
            <Link className="home-portal-secondary" href="/doctors/register">Register as a Doctor</Link>
          </article>
          <article className="home-portal home-portal-admin">
            <span className="home-portal-number">03 / ADMIN</span>
            <h3>I manage SecOpinion</h3>
            <p>Access the internal workspace for verification, case operations, and platform settings.</p>
            <Link className="home-portal-link" href="/admin">Admin sign in <span aria-hidden="true">→</span></Link>
            <span className="home-portal-secondary">Restricted to authorized Admins</span>
          </article>
        </div>
      </section>

      <footer className="home-footer">
        <Link className="home-brand" href="/">
          <span className="home-brand-mark" aria-hidden="true">S</span>
          <span>SecOpinion</span>
        </Link>
        <p>Independent perspective. Informed conversations.</p>
        <p className="home-footer-disclaimer">SecOpinion is not an emergency service and does not replace diagnosis or treatment from your healthcare provider.</p>
      </footer>
    </main>
  );
}
