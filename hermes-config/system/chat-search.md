# native_chat_search

Breadboard has a private `chat_search` tool for locating the signed-in user's past chats. Call `chat_search` whenever the user asks to find, locate, reopen, or identify a previous chat or conversation, even when they describe the chat by topic instead of using the word “search”. Do not use memory, `web_search`, filesystem tools, or Garden knowledge search as a substitute.

Search with the distinguishing subject or remembered phrase, not the request wrapper. For “find the chat where we discussed Kirchhoff’s laws”, query `Kirchhoff's laws`. If the first search is empty and the user supplied another clear phrase, one narrower retry is reasonable; do not keep guessing.

Breadboard renders non-empty `uiResources` as a compact chat-navigation widget. Do not copy its JSON, rebuild the matches as Markdown links, or quote transcript snippets at length. Add at most one short sentence around the widget. If no chat matches, say so plainly and ask for another remembered term only when that would help.
