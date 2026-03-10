import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface MarkdownPreviewProps {
  content: string;
  fontSize?: number;
}

/**
 * Renders Markdown content with support for {@cite_key} and {{@image_id}} references.
 * References are displayed as styled inline badges.
 */
export function MarkdownPreview({ content, fontSize = 13 }: MarkdownPreviewProps) {
  // Pre-process: convert {@cite} and {{@image}} to markdown-friendly inline HTML spans
  const processed = content
    // {{@image_id}} → image badge
    .replace(/\{\{@([^}]+)\}\}/g, '<span class="ref-image">$1</span>')
    // {@cite_key} or {@A; @B} → cite badge(s)
    .replace(/\{(@[^}]+)\}/g, (_match, inner: string) => {
      const keys = inner.split(";").map((s: string) => s.trim().replace(/^@/, ""));
      return keys
        .map((k: string) => `<span class="ref-cite">${k}</span>`)
        .join(" ");
    });

  return (
    <div className="markdown-preview" style={{ fontSize, lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          h1: ({ children, ...props }) => (
            <h1 style={{ fontSize: "1.6em", fontWeight: 700, margin: "0.5em 0 0.3em", borderBottom: "1px solid #e5e7eb", paddingBottom: "0.2em" }} {...props}>{children}</h1>
          ),
          h2: ({ children, ...props }) => (
            <h2 style={{ fontSize: "1.35em", fontWeight: 700, margin: "0.4em 0 0.2em", borderBottom: "1px solid #f3f4f6", paddingBottom: "0.15em" }} {...props}>{children}</h2>
          ),
          h3: ({ children, ...props }) => (
            <h3 style={{ fontSize: "1.15em", fontWeight: 600, margin: "0.3em 0 0.15em" }} {...props}>{children}</h3>
          ),
          h4: ({ children, ...props }) => (
            <h4 style={{ fontSize: "1.05em", fontWeight: 600, margin: "0.2em 0 0.1em" }} {...props}>{children}</h4>
          ),
          p: ({ children, ...props }) => (
            <p style={{ margin: "0.3em 0" }} {...props}>{children}</p>
          ),
          ul: ({ children, ...props }) => (
            <ul style={{ margin: "0.3em 0", paddingLeft: "1.5em" }} {...props}>{children}</ul>
          ),
          ol: ({ children, ...props }) => (
            <ol style={{ margin: "0.3em 0", paddingLeft: "1.5em" }} {...props}>{children}</ol>
          ),
          li: ({ children, ...props }) => (
            <li style={{ margin: "0.1em 0" }} {...props}>{children}</li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote style={{ margin: "0.3em 0", paddingLeft: "0.8em", borderLeft: "3px solid #d1d5db", color: "#6b7280" }} {...props}>{children}</blockquote>
          ),
          code: ({ children, className, ...props }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <pre style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "0.5em 0.8em", overflow: "auto", fontSize: "0.9em", margin: "0.3em 0" }}>
                  <code className={className} {...props}>{children}</code>
                </pre>
              );
            }
            return (
              <code style={{ background: "#f1f5f9", padding: "0.1em 0.3em", borderRadius: 3, fontSize: "0.9em" }} {...props}>{children}</code>
            );
          },
          table: ({ children, ...props }) => (
            <table style={{ borderCollapse: "collapse", margin: "0.3em 0", width: "100%" }} {...props}>{children}</table>
          ),
          th: ({ children, ...props }) => (
            <th style={{ border: "1px solid #d1d5db", padding: "0.3em 0.6em", background: "#f9fafb", textAlign: "left", fontWeight: 600, fontSize: "0.95em" }} {...props}>{children}</th>
          ),
          td: ({ children, ...props }) => (
            <td style={{ border: "1px solid #e5e7eb", padding: "0.3em 0.6em", fontSize: "0.95em" }} {...props}>{children}</td>
          ),
          hr: ({ ...props }) => (
            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "0.5em 0" }} {...props} />
          ),
          a: ({ children, href, ...props }) => (
            <a href={href} style={{ color: "#2563eb", textDecoration: "underline" }} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
          ),
          // Render reference badges from our pre-processed HTML spans
          span: ({ className, children, ...props }) => {
            if (className === "ref-cite") {
              return (
                <span style={citeBadgeStyle} {...props}>{children}</span>
              );
            }
            if (className === "ref-image") {
              return (
                <span style={imageBadgeStyle} {...props}>{children}</span>
              );
            }
            return <span className={className} {...props}>{children}</span>;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}

const citeBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(5, 150, 105, 0.12)",
  color: "#059669",
  fontSize: "0.85em",
  fontFamily: "monospace",
  padding: "1px 5px",
  borderRadius: 3,
  border: "1px solid rgba(5, 150, 105, 0.25)",
  verticalAlign: "baseline",
};

const imageBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  background: "rgba(8, 145, 178, 0.12)",
  color: "#0891b2",
  fontSize: "0.85em",
  fontFamily: "monospace",
  padding: "1px 5px",
  borderRadius: 3,
  border: "1px solid rgba(8, 145, 178, 0.25)",
  verticalAlign: "baseline",
};
