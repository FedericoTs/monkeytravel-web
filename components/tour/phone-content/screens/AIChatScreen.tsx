"use client";

import { motion, Variants } from "framer-motion";

// Animated typing effect for AI responses
interface TypingTextProps {
  text: string;
  delay?: number;
  speed?: number;
  className?: string;
}

function TypingText({ text, delay = 0, speed = 0.03, className = "" }: TypingTextProps) {
  return (
    <span className={className}>
      {text.split("").map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + index * speed }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

// Chat bubble component
interface ChatBubbleProps {
  type: "user" | "ai";
  children: React.ReactNode;
  delay?: number;
  typing?: boolean;
}

function ChatBubble({ type, children, delay = 0, typing = false }: ChatBubbleProps) {
  const isUser = type === "user";

  const bubbleVariants: Variants = {
    hidden: {
      opacity: 0,
      y: 20,
      scale: 0.9,
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
    },
  };

  return (
    <motion.div
      variants={bubbleVariants}
      initial="hidden"
      animate="visible"
      transition={{
        type: "spring",
        stiffness: 200,
        damping: 20,
        delay,
      }}
      className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}
    >
      {!isUser && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: delay - 0.1, type: "spring" }}
          className="w-6 h-6 rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E8E] flex items-center justify-center mr-1.5 flex-shrink-0 shadow-md"
        >
          <span className="text-[10px]">🐵</span>
        </motion.div>
      )}
      <div
        className={`max-w-[75%] px-3 py-2 rounded-2xl text-[10px] leading-relaxed ${
          isUser
            ? "bg-[#FF6B6B] text-white rounded-br-sm"
            : "bg-white text-gray-800 rounded-bl-sm shadow-sm border border-gray-100"
        }`}
      >
        {typing ? (
          <div className="flex items-center gap-1 py-1">
            <motion.span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, delay: 0 }}
            />
            <motion.span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, delay: 0.1 }}
            />
            <motion.span
              className="w-1.5 h-1.5 bg-gray-400 rounded-full"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 0.5, repeat: Infinity, delay: 0.2 }}
            />
          </div>
        ) : (
          children
        )}
      </div>
    </motion.div>
  );
}

// AI Action indicator
interface AIActionProps {
  action: string;
  delay?: number;
}

function AIAction({ action, delay = 0 }: AIActionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring" }}
      className="flex items-center justify-center my-2"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-[#FF6B6B]/10 to-[#00B4A6]/10 rounded-full border border-[#FF6B6B]/20">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="w-3 h-3 border-2 border-[#FF6B6B] border-t-transparent rounded-full"
        />
        <span className="text-[9px] font-medium text-gray-600">{action}</span>
      </div>
    </motion.div>
  );
}

export default function AIChatScreen() {
  return (
    <div className="absolute inset-0 flex flex-col pt-14 pb-4 px-3">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#FF6B6B] to-[#FF8E8E] flex items-center justify-center shadow-lg">
          <span className="text-sm">🐵</span>
        </div>
        <div>
          <h3 className="text-[11px] font-bold text-gray-900">MonkeyTravel AI</h3>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[8px] text-gray-500">Online • Ready to plan</span>
          </div>
        </div>
      </motion.div>

      {/* Chat messages */}
      <div className="flex-1 overflow-hidden flex flex-col justify-end">
        {/* AI Greeting */}
        <ChatBubble type="ai" delay={0.3}>
          <span>Hi! 👋 I&apos;m your AI travel assistant. Where would you like to go?</span>
        </ChatBubble>

        {/* User message */}
        <ChatBubble type="user" delay={0.8}>
          <span>I want to visit Barcelona for 5 days!</span>
        </ChatBubble>

        {/* AI acknowledges */}
        <ChatBubble type="ai" delay={1.4}>
          <span>Great choice! 🇪🇸 Barcelona is amazing. Let me ask a few questions to personalize your trip...</span>
        </ChatBubble>

        {/* Quick questions */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.0 }}
          className="flex flex-wrap gap-1.5 ml-8 mb-2"
        >
          {["Culture & History", "Food & Wine", "Beach & Relaxation"].map((tag, i) => (
            <motion.button
              key={tag}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 2.2 + i * 0.1, type: "spring" }}
              className={`px-2 py-1 rounded-full text-[8px] font-medium border transition-all ${
                i === 0
                  ? "bg-[#FF6B6B] text-white border-[#FF6B6B]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#FF6B6B]"
              }`}
            >
              {tag}
            </motion.button>
          ))}
        </motion.div>

        {/* User selects */}
        <ChatBubble type="user" delay={2.8}>
          <span>Culture & History please!</span>
        </ChatBubble>

        {/* AI starts planning */}
        <AIAction action="Creating your personalized itinerary..." delay={3.3} />
      </div>

      {/* Input area */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="mt-2 flex items-center gap-2"
      >
        <div className="flex-1 bg-gray-100 rounded-full px-3 py-2 flex items-center">
          <input
            type="text"
            placeholder="Ask me anything..."
            className="flex-1 bg-transparent text-[10px] text-gray-600 placeholder-gray-400 outline-none"
            disabled
          />
        </div>
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="w-8 h-8 bg-[#FF6B6B] rounded-full flex items-center justify-center shadow-lg"
        >
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" />
          </svg>
        </motion.button>
      </motion.div>
    </div>
  );
}
