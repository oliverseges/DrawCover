"use client";

import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

const messages = [
  "Turning your lines into a record",
  "It's my credits, not yours. You'd better wait!",
  "I am paying for the music, not the speed",
  "Your doodle has asked for a producer",
  "Good records take time. Questionable doodles take longer",
];

export function RecordingStatus() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex(value => (value + 1) % messages.length), 4500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="making-status" role="status">
      <LoaderCircle size={15} className="spin" aria-hidden="true" />
      <span className="sr-only">Turning your lines into a record. This can take a minute.</span>
      <span aria-hidden="true">{messages[index]}<span className="loading-dots">...</span></span>
    </div>
  );
}
