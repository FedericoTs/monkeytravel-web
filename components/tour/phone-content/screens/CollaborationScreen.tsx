"use client";

import { motion } from "framer-motion";

const collaborators = [
  { name: "You", avatar: "👤", isOwner: true },
  { name: "Sarah", avatar: "👩", vote: "up" },
  { name: "Mike", avatar: "👨", vote: "up" },
  { name: "Emma", avatar: "👩‍🦰", vote: null },
];

const activities = [
  {
    name: "Sagrada Familia",
    time: "10:00 AM",
    votes: { up: 3, down: 0 },
    status: "confirmed",
  },
  {
    name: "La Boqueria Market",
    time: "1:00 PM",
    votes: { up: 2, down: 1 },
    status: "voting",
  },
];

export default function CollaborationScreen() {
  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-slate-50 to-white">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-slate-800">Barcelona Trip</h2>
          <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">
            Live
          </span>
        </div>
        {/* Collaborator avatars */}
        <div className="flex items-center gap-1">
          {collaborators.map((c, i) => (
            <motion.div
              key={c.name}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              className="relative"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center text-sm border-2 border-white shadow-sm">
                {c.avatar}
              </div>
              {c.isOwner && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-amber-400 rounded-full flex items-center justify-center">
                  <span className="text-[6px]">👑</span>
                </div>
              )}
            </motion.div>
          ))}
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.7 }}
            className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 border-2 border-dashed border-slate-300"
          >
            <span className="text-xs">+</span>
          </motion.button>
        </div>
      </div>

      {/* Activities with voting */}
      <div className="flex-1 px-3 py-3 space-y-2 overflow-hidden">
        {activities.map((activity, index) => (
          <motion.div
            key={activity.name}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ delay: 0.5 + index * 0.15 }}
            className={`p-3 rounded-xl border ${
              activity.status === "confirmed"
                ? "bg-emerald-50/50 border-emerald-200"
                : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {activity.name}
                  </span>
                  {activity.status === "confirmed" && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded font-medium">
                      Confirmed
                    </span>
                  )}
                  {activity.status === "voting" && (
                    <motion.span
                      animate={{ opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.5, repeat: Infinity }}
                      className="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium"
                    >
                      Voting
                    </motion.span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500">{activity.time}</span>
              </div>

              {/* Voting buttons */}
              <div className="flex items-center gap-1">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-emerald-100 text-emerald-600"
                >
                  <span className="text-[10px]">👍</span>
                  <span className="text-[10px] font-medium">{activity.votes.up}</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-lg bg-slate-100 text-slate-500"
                >
                  <span className="text-[10px]">👎</span>
                  <span className="text-[10px] font-medium">{activity.votes.down}</span>
                </motion.button>
              </div>
            </div>

            {/* Voter avatars */}
            {activity.status === "voting" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
                className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100"
              >
                <span className="text-[9px] text-slate-400 mr-1">Votes:</span>
                {collaborators
                  .filter((c) => c.vote)
                  .map((c) => (
                    <div
                      key={c.name}
                      className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px]"
                    >
                      {c.avatar}
                    </div>
                  ))}
                <span className="text-[9px] text-slate-400">waiting for Emma...</span>
              </motion.div>
            )}
          </motion.div>
        ))}

        {/* Real-time update notification */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 1.2 }}
          className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-100"
        >
          <div className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[10px]">
            👩
          </div>
          <span className="text-[10px] text-blue-700">
            Sarah suggested: Park Guell at 4 PM
          </span>
        </motion.div>
      </div>

      {/* Bottom action */}
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.0 }}
        className="px-3 pb-3"
      >
        <button className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-500 to-blue-500 text-white text-xs font-semibold shadow-lg shadow-purple-500/20">
          + Suggest Activity
        </button>
      </motion.div>
    </div>
  );
}
