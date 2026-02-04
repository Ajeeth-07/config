import React, { useEffect, useRef } from "react";

function Terminal({ logs, isRunning }) {
  const terminalRef = useRef(null);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="terminal" ref={terminalRef}>
      <p className="terminal-line info">
        C:\AI_CONFIG&gt; Starting input configuration generator...
      </p>
      <p className="terminal-line">
        -------------------------------------------
      </p>
      {logs.map((log, idx) => (
        <p key={idx} className={`terminal-line ${log.type || ""}`}>
          [{log.timestamp}] {log.message}
        </p>
      ))}
      {isRunning && (
        <p className="terminal-line">
          <span className="terminal-cursor"></span>
        </p>
      )}
      {!isRunning && logs.length > 0 && (
        <p className="terminal-line info">C:\AI_CONFIG&gt; _</p>
      )}
    </div>
  );
}

export default Terminal;
