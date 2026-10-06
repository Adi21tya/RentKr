import { useEffect, useState, useRef, createContext, useContext, useCallback } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, useNavigate, useLocation, Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Toaster, toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home, Search, Building2, Shield, Sparkles, Users, BadgeCheck,
  MessageCircle, X, Send, Menu, LogOut, User, ChevronRight, ChevronLeft,
  MapPin, Bed, Bath, Square, Heart, Star, ArrowRight, Play,
  CheckCircle2, Clock, TrendingUp, Phone, Mail, Key, Building,
  IndianRupee, Filter, SlidersHorizontal, Plus, Trash2, Ban, AlertCircle
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Textarea } from "./components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "./components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

// ================== LOCAL STATE (SAVED + MESSAGES) ==================
const SAVED_KEY = "rentkr:saved_property_ids:v1";
const THREADS_KEY_PREFIX = "rentkr:tenant_threads:v1:";

function safeJsonParse(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

// Saved Properties Context
const SavedPropertiesContext = createContext(null);
const useSavedProperties = () => useContext(SavedPropertiesContext);

const SavedPropertiesProvider = ({ children }) => {
  const [savedIds, setSavedIds] = useState(() => {
    const raw = localStorage.getItem(SAVED_KEY);
    const parsed = safeJsonParse(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  });

  useEffect(() => {
    localStorage.setItem(SAVED_KEY, JSON.stringify(savedIds));
  }, [savedIds]);

  const isSaved = (propertyId) => savedIds.includes(propertyId);

  const toggleSaved = (propertyId) => {
    setSavedIds((prev) => (
      prev.includes(propertyId) ? prev.filter((id) => id !== propertyId) : [...prev, propertyId]
    ));
  };

  return (
    <SavedPropertiesContext.Provider value={{ savedIds, isSaved, toggleSaved, setSavedIds }}>
      {children}
    </SavedPropertiesContext.Provider>
  );
};

// Messaging Context (API Based)
const MessagingContext = createContext(null);
export const useMessaging = () => useContext(MessagingContext);

const MessagingProvider = ({ children }) => {
  const { user } = useAuth();
  const [threads, setThreads] = useState({});
  const [loading, setLoading] = useState(false);

  // Fetch threads from API
  const fetchThreads = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API}/threads`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      // Convert list to object map for easier lookup
      const threadsMap = {};
      res.data.forEach(t => {
        threadsMap[t.thread_id] = t;
      });
      setThreads(threadsMap);
    } catch (e) {
      console.error("Failed to fetch threads", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchThreads();
      // Optional: Poll for new messages every 30s
      const interval = setInterval(fetchThreads, 30000);
      return () => clearInterval(interval);
    } else {
      setThreads({});
    }
  }, [user, fetchThreads]);

  const contactLandlord = async (propertyId, messageContent) => {
    if (!user) throw new Error("Auth required");
    const token = localStorage.getItem("token");
    const res = await axios.post(`${API}/properties/${propertyId}/contact`,
      { content: messageContent },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchThreads(); // Refresh threads
    return res.data.thread_id;
  };

  const sendMessage = async (threadId, content) => {
    if (!user) throw new Error("Auth required");
    const token = localStorage.getItem("token");
    await axios.post(`${API}/threads/${threadId}/reply`,
      { content },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    await fetchThreads(); // Refresh to see new message
  };

  return (
    <MessagingContext.Provider value={{ threads, loading, contactLandlord, sendMessage, refresh: fetchThreads }}>
      {children}
    </MessagingContext.Provider>
  );
};

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem("token");
      if (token) {
        const response = await axios.get(`${API}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          withCredentials: true
        });
        setUser(response.data);
      }
    } catch (error) {
      localStorage.removeItem("token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const response = await axios.post(`${API}/auth/login`, { email, password });
    localStorage.setItem("token", response.data.token);
    setUser(response.data.user);
    return response.data;
  };

  const register = async (userData) => {
    const response = await axios.post(`${API}/auth/register`, userData);
    return response.data;
  };

  const logout = async () => {
    try {
      await axios.post(`${API}/auth/logout`, {}, { withCredentials: true });
    } catch (e) { }
    localStorage.removeItem("token");
    setUser(null);
  };

  const googleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + '/auth/callback';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  return (
    <AuthContext.Provider value={{ user, setUser, login, register, logout, googleLogin, loading, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

// Auth Callback Component
const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setUser } = useAuth();
  const hasProcessed = useRef(false);

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const processSession = async () => {
      const hash = location.hash;
      const sessionIdMatch = hash.match(/session_id=([^&]+)/);

      if (sessionIdMatch) {
        const sessionId = sessionIdMatch[1];
        try {
          const response = await axios.post(`${API}/auth/session`,
            { session_id: sessionId },
            { withCredentials: true }
          );
          setUser(response.data);
          toast.success(`Welcome, ${response.data.name}!`);

          // Redirect based on user type
          if (response.data.user_type === "landlord") {
            navigate("/landlord", { replace: true, state: { user: response.data } });
          } else {
            navigate("/tenant", { replace: true, state: { user: response.data } });
          }
        } catch (error) {
          toast.error("Authentication failed");
          navigate("/", { replace: true });
        }
      } else {
        navigate("/", { replace: true });
      }
    };

    processSession();
  }, [location.hash, navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-600 mx-auto"></div>
        <p className="mt-4 text-slate-600">Authenticating...</p>
      </div>
    </div>
  );
};

// Navbar Component
const Navbar = () => {
  const { user, setUser, logout, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-slate-200/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center">
                <Home className="w-5 h-5 text-white" />
              </div>
              <span className="font-manrope font-bold text-xl text-slate-900">RentKr</span>
            </Link>

            <div className="hidden md:flex items-center gap-6">
              {(!user || user.user_type === "tenant") && (
                <Link to="/properties" className="text-slate-600 hover:text-rose-600 transition-colors font-medium" data-testid="nav-properties">
                  Properties
                </Link>
              )}
              <Link to="/pricing" className="text-slate-600 hover:text-rose-600 transition-colors font-medium" data-testid="nav-pricing">
                Pricing
              </Link>
              {user && (
                <Link
                  to={user.user_type === "landlord" ? "/landlord/messages" : "/tenant/messages"}
                  className="text-slate-600 hover:text-rose-600 transition-colors font-medium"
                >
                  Messages
                </Link>
              )}

              {user ? (
                <div className="flex items-center gap-4">
                  <Link
                    to={user.user_type === "admin" ? "/admin" : (user.user_type === "landlord" ? "/landlord" : "/tenant")}
                    className="text-slate-600 hover:text-rose-600 transition-colors font-medium"
                    data-testid="nav-dashboard"
                  >
                    Dashboard
                  </Link>
                  <div
                    className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 px-2 rounded-full transition-colors border border-transparent hover:border-slate-200"
                    onClick={() => setShowProfileModal(true)}
                  >
                    <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center overflow-hidden">
                      {user.picture ? (
                        <img src={user.picture} alt="" className="w-8 h-8 object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-rose-600" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-slate-700">{user.name}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={logout} data-testid="logout-btn">
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => { setAuthMode("login"); setShowAuthModal(true); }}
                    data-testid="login-btn"
                  >
                    Log In
                  </Button>
                  <Button
                    className="bg-rose-600 hover:bg-rose-700 text-white rounded-full px-6"
                    onClick={() => { setAuthMode("register"); setShowAuthModal(true); }}
                    data-testid="signup-btn"
                  >
                    Sign Up
                  </Button>
                </div>
              )}
            </div>

            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild className="md:hidden">
                <Button variant="ghost" size="sm">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72">
                <div className="flex flex-col gap-4 mt-8">
                  {(!user || user.user_type === "tenant") && (
                    <Link to="/properties" className="text-lg font-medium" onClick={() => setMobileMenuOpen(false)}>
                      Properties
                    </Link>
                  )}
                  <Link to="/pricing" className="text-lg font-medium" onClick={() => setMobileMenuOpen(false)}>
                    Pricing
                  </Link>
                  {user && (
                    <Link
                      to={user.user_type === "landlord" ? "/landlord/messages" : "/tenant/messages"}
                      className="text-lg font-medium"
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      Messages
                    </Link>
                  )}
                  {user ? (
                    <>
                      <Link
                        to={user.user_type === "landlord" ? "/landlord" : "/tenant"}
                        className="text-lg font-medium"
                        onClick={() => setMobileMenuOpen(false)}
                      >
                        Dashboard
                      </Link>
                      <Button variant="outline" onClick={() => { logout(); setMobileMenuOpen(false); }}>
                        Log Out
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => { setAuthMode("login"); setShowAuthModal(true); setMobileMenuOpen(false); }}>
                        Log In
                      </Button>
                      <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => { setAuthMode("register"); setShowAuthModal(true); setMobileMenuOpen(false); }}>
                        Sign Up
                      </Button>
                    </>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode={authMode}
        setMode={setAuthMode}
      />
      <ProfileModal
        open={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        user={user}
        onUpdate={(updated) => setUser(updated)}
      />
    </>
  );
};

// Auth Modal Component
const AuthModal = ({ open, onClose, mode, setMode }) => {
  const { login, register, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    user_type: "tenant",
    phone: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const data = await login(formData.email, formData.password);
        toast.success(`Welcome back, ${data.user.name}!`);
        onClose();
        if (data.user.user_type === "admin") navigate("/admin");
        else navigate(data.user.user_type === "landlord" ? "/landlord" : "/tenant");
      } else {
        await register(formData);
        const data = await login(formData.email, formData.password);
        toast.success(`Welcome, ${data.user.name}!`);
        onClose();
        if (data.user.user_type === "admin") navigate("/admin");
        else navigate(data.user.user_type === "landlord" ? "/landlord" : "/tenant");
      }
    } catch (error) {
      toast.error(error.response?.data?.detail || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl font-manrope">
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "register" && (
            <>
              <div>
                <Label>Full Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter your name"
                  required
                  data-testid="register-name"
                />
              </div>
              <div>
                <Label>I am a</Label>
                <Select value={formData.user_type} onValueChange={(v) => setFormData({ ...formData, user_type: v })}>
                  <SelectTrigger data-testid="register-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tenant">Tenant (Looking for a home)</SelectItem>
                    <SelectItem value="landlord">Landlord (Listing property)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="you@example.com"
              required
              data-testid={`${mode}-email`}
            />
          </div>

          <div>
            <Label>Password</Label>
            <Input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              required
              data-testid={`${mode}-password`}
            />
          </div>

          <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-700" disabled={loading} data-testid={`${mode}-submit`}>
            {loading ? "Please wait..." : mode === "login" ? "Log In" : "Create Account"}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-slate-500">Or continue with</span>
            </div>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={googleLogin} data-testid="google-login">
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </Button>
        </form>

        <div className="text-center text-sm">
          {mode === "login" ? (
            <p>Don't have an account? <button className="text-rose-600 font-medium" onClick={() => setMode("register")}>Sign up</button></p>
          ) : (
            <p>Already have an account? <button className="text-rose-600 font-medium" onClick={() => setMode("login")}>Log in</button></p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// AI Chat Component
const AIChatWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hi! I'm RentKr AI Assistant. How can I help you find your perfect home today?" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    setLoading(true);

    try {
      const response = await axios.post(`${API}/ai/chat`, { message: userMessage });
      setMessages(prev => [...prev, { role: "assistant", content: response.data.response }]);
    } catch (error) {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I'm having trouble connecting. Please try again." }]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-24 right-6 z-50 w-96 max-w-[calc(100vw-3rem)]"
          >
            <Card className="shadow-2xl border-slate-200">
              <CardHeader className="bg-gradient-to-r from-rose-600 to-rose-700 text-white rounded-t-lg pb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">RentKr AI</CardTitle>
                      <p className="text-rose-100 text-sm">Your rental assistant</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="text-white hover:bg-white/20">
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              </CardHeader>

              <ScrollArea className="h-80 p-4" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${msg.role === "user"
                        ? "bg-rose-600 text-white rounded-br-none"
                        : "bg-slate-100 text-slate-800 rounded-bl-none"
                        }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="bg-slate-100 rounded-2xl px-4 py-2 rounded-bl-none">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                          <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="p-4 border-t">
                <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="flex gap-2">
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about properties, areas..."
                    className="flex-1"
                    data-testid="chat-input"
                  />
                  <Button type="submit" size="icon" className="bg-rose-600 hover:bg-rose-700" data-testid="chat-send">
                    <Send className="w-4 h-4" />
                  </Button>
                </form>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-white shadow-lg shadow-rose-600/30 flex items-center justify-center chat-button"
        data-testid="chat-toggle"
      >
        {isOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </motion.button>
    </>
  );
};

// Landing Page
const LandingPage = () => {
  const [stats, setStats] = useState({
    total_properties: 150,
    verified_properties: 120,
    total_users: 500,
    cities_covered: 12
  });
  const [featuredProperties, setFeaturedProperties] = useState([]);
  const { user, googleLogin } = useAuth();
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("register");
  const location = useLocation();

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, propertiesRes] = await Promise.all([
          axios.get(`${API}/stats`),
          axios.get(`${API}/properties/featured?limit=6`)
        ]);
        setStats(statsRes.data);
        setFeaturedProperties(propertiesRes.data);
      } catch (e) {
        console.log("Error fetching data");
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.replace("#", ""));
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [location.hash]);

  const handleGetStarted = () => {
    if (user) {
      navigate(user.user_type === "landlord" ? "/landlord" : "/tenant");
    } else {
      setShowAuthModal(true);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src="https://images.unsplash.com/photo-1627141234469-24711efb373c?crop=entropy&cs=srgb&fm=jpg&q=85"
            alt="Modern home"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-slate-900/95 via-slate-900/80 to-transparent" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 lg:px-8 py-32 pt-40">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="max-w-2xl"
          >
            <div className="flex items-center gap-2 mb-6">
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 px-3 py-1">
                <Sparkles className="w-3 h-3 mr-1" /> AI-Powered
              </Badge>
              <Badge className="bg-teal-500/20 text-teal-300 border-teal-500/30 px-3 py-1">
                Zero Brokerage
              </Badge>
            </div>

            <h1 className="text-5xl md:text-7xl font-manrope font-extrabold text-white tracking-tight leading-tight mb-6">
              Find Your <span className="text-rose-500">Perfect Home</span> Without Brokers
            </h1>

            <p className="text-xl text-slate-300 mb-10 leading-relaxed max-w-xl">
              RentKr connects tenants directly with verified landlords. No middlemen, no brokerage fees—just AI-verified listings you can trust.
            </p>

            <div className="flex flex-wrap gap-4">
              <Button
                size="lg"
                className="bg-rose-600 hover:bg-rose-700 text-white rounded-full px-8 py-6 text-lg shadow-lg shadow-rose-600/30 transition-all hover:scale-105"
                onClick={handleGetStarted}
                data-testid="hero-find-home"
              >
                Find a Home <ArrowRight className="ml-2 w-5 h-5" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/30 text-white hover:bg-white/10 rounded-full px-8 py-6 text-lg"
                onClick={() => navigate("/pricing")}
                data-testid="hero-list-property"
              >
                List Property <Building2 className="ml-2 w-5 h-5" />
              </Button>
            </div>

            <div className="flex items-center gap-8 mt-12">
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{stats.total_properties}+</p>
                <p className="text-slate-400 text-sm">Properties</p>
              </div>
              <div className="w-px h-12 bg-slate-700" />
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{stats.verified_properties}+</p>
                <p className="text-slate-400 text-sm">Verified</p>
              </div>
              <div className="w-px h-12 bg-slate-700" />
              <div className="text-center">
                <p className="text-3xl font-bold text-white">{stats.cities_covered}</p>
                <p className="text-slate-400 text-sm">Cities</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust Badges */}
      <section className="py-16 bg-slate-50 border-y border-slate-200">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { icon: BadgeCheck, title: "AI Verified", desc: "All listings verified" },
              { icon: Shield, title: "Secure Platform", desc: "Data protection" },
              { icon: IndianRupee, title: "Zero Brokerage", desc: "Free for tenants" },
              { icon: Sparkles, title: "Smart Matching", desc: "AI recommendations" }
            ].map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
                className="flex flex-col items-center text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-rose-100 flex items-center justify-center mb-4">
                  <item.icon className="w-7 h-7 text-rose-600" />
                </div>
                <h3 className="font-semibold text-slate-900">{item.title}</h3>
                <p className="text-slate-500 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="bg-rose-100 text-rose-700 mb-4">Simple Process</Badge>
            <h2 className="text-4xl md:text-5xl font-manrope font-bold text-slate-900 tracking-tight">
              How RentKr Works
            </h2>
          </div>

          <Tabs defaultValue="tenant" className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-2 mb-12">
              <TabsTrigger value="tenant" className="text-lg py-3">For Tenants</TabsTrigger>
              <TabsTrigger value="landlord" className="text-lg py-3">For Landlords</TabsTrigger>
            </TabsList>

            <TabsContent value="tenant">
              <div className="grid md:grid-cols-3 gap-8">
                {[
                  { step: "01", title: "Search & Filter", desc: "Browse AI-verified listings with smart filters", icon: Search },
                  { step: "02", title: "Get AI Match", desc: "See personalized match scores for each property", icon: Sparkles },
                  { step: "03", title: "Connect Direct", desc: "Chat with landlords directly—no middlemen", icon: MessageCircle }
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    viewport={{ once: true }}
                    className="relative"
                  >
                    <Card className="p-8 border-slate-200 hover:border-rose-200 transition-colors h-full">
                      <span className="text-6xl font-bold text-slate-100 absolute top-4 right-4">{item.step}</span>
                      <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center mb-6">
                        <item.icon className="w-6 h-6 text-rose-600" />
                      </div>
                      <h3 className="text-xl font-semibold text-slate-900 mb-2">{item.title}</h3>
                      <p className="text-slate-500">{item.desc}</p>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="landlord">
              <div className="grid md:grid-cols-3 gap-8">
                {[
                  { step: "01", title: "List Property", desc: "Add your property with photos and details", icon: Building2 },
                  { step: "02", title: "Get Verified", desc: "AI verifies your documents and listing", icon: BadgeCheck },
                  { step: "03", title: "Find Tenants", desc: "Receive inquiries from verified tenants", icon: Users }
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.15 }}
                    viewport={{ once: true }}
                    className="relative"
                  >
                    <Card className="p-8 border-slate-200 hover:border-rose-200 transition-colors h-full">
                      <span className="text-6xl font-bold text-slate-100 absolute top-4 right-4">{item.step}</span>
                      <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center mb-6">
                        <item.icon className="w-6 h-6 text-rose-600" />
                      </div>
                      <h3 className="text-xl font-semibold text-slate-900 mb-2">{item.title}</h3>
                      <p className="text-slate-500">{item.desc}</p>
                    </Card>
                  </motion.div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {/* Featured Properties */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between mb-12">
            <div>
              <Badge className="bg-rose-100 text-rose-700 mb-4">Featured Listings</Badge>
              <h2 className="text-4xl font-manrope font-bold text-slate-900">
                Handpicked Properties
              </h2>
            </div>
            <Button variant="outline" className="hidden md:flex" onClick={() => navigate("/properties")}>
              View All <ChevronRight className="ml-1 w-4 h-4" />
            </Button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {(featuredProperties.length > 0 ? featuredProperties : [
              { property_id: "1", title: "Modern 2BHK in Koramangala", city: "Bangalore", location: "Koramangala", rent: 35000, bedrooms: 2, bathrooms: 2, area_sqft: 1100, property_type: "apartment", is_verified: true },
              { property_id: "2", title: "Spacious 3BHK Villa", city: "Mumbai", location: "Bandra West", rent: 85000, bedrooms: 3, bathrooms: 3, area_sqft: 2200, property_type: "villa", is_verified: true },
              { property_id: "3", title: "Studio near Tech Park", city: "Hyderabad", location: "Gachibowli", rent: 18000, bedrooms: 1, bathrooms: 1, area_sqft: 550, property_type: "studio", is_verified: true }
            ]).map((property, i) => (
              <PropertyCard key={property.property_id} property={property} index={i} />
            ))}
          </div>

          <div className="text-center mt-8 md:hidden">
            <Button variant="outline" onClick={() => navigate("/properties")}>
              View All Properties
            </Button>
          </div>
        </div>
      </section>

      {/* AI Features */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 mb-4">
              <Sparkles className="w-3 h-3 mr-1" /> Powered by AI
            </Badge>
            <h2 className="text-4xl md:text-5xl font-manrope font-bold tracking-tight">
              Smart Features for Smart Renters
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Sparkles, title: "AI Match Score", desc: "Get personalized compatibility scores for each property based on your preferences" },
              { icon: MessageCircle, title: "AI Chat Assistant", desc: "Ask questions about neighborhoods, pricing, and get instant recommendations" },
              { icon: BadgeCheck, title: "Document Verification", desc: "AI-powered verification of property documents for trust and security" },
              { icon: TrendingUp, title: "Price Insights", desc: "Know if the rent is fair with AI-analyzed market data" },
              { icon: Shield, title: "Fraud Detection", desc: "Advanced AI to detect fake listings and suspicious activity" },
              { icon: Clock, title: "Smart Notifications", desc: "Get alerts when matching properties become available" }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                viewport={{ once: true }}
              >
                <Card className="p-8 bg-slate-800/50 border-slate-700 hover:bg-slate-800 transition-colors h-full">
                  <div className="w-12 h-12 rounded-xl bg-rose-500/20 flex items-center justify-center mb-6">
                    <feature.icon className="w-6 h-6 text-rose-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-slate-400">{feature.desc}</p>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-gradient-to-br from-rose-600 to-rose-700">
        <div className="max-w-4xl mx-auto px-6 lg:px-8 text-center">
          <h2 className="text-4xl md:text-5xl font-manrope font-bold text-white mb-6">
            Ready to Find Your Dream Home?
          </h2>
          <p className="text-xl text-rose-100 mb-10">
            Join thousands of happy tenants who found their perfect home without paying brokerage.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button
              size="lg"
              className="bg-white text-rose-600 hover:bg-rose-50 rounded-full px-8 py-6 text-lg"
              onClick={handleGetStarted}
              data-testid="cta-get-started"
            >
              Get Started Free
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="border-white text-white hover:bg-white/10 rounded-full px-8 py-6 text-lg"
              onClick={() => navigate("/pricing")}
            >
              View Pricing
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-16 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid md:grid-cols-4 gap-12">
            <div>
              <div className="flex items-center gap-2 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-rose-700 flex items-center justify-center">
                  <Home className="w-5 h-5 text-white" />
                </div>
                <span className="font-manrope font-bold text-xl">RentKr</span>
              </div>
              <p className="text-slate-400">
                AI-powered rental platform connecting tenants and landlords directly.
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">For Tenants</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/properties" className="hover:text-rose-400 transition-colors">Search Properties</Link></li>
                <li><Link to="/tenant" className="hover:text-rose-400 transition-colors">Dashboard</Link></li>
                <li><Link to="/#how-it-works" className="hover:text-rose-400 transition-colors">How it Works</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">For Landlords</h4>
              <ul className="space-y-2 text-slate-400">
                <li><Link to="/pricing" className="hover:text-rose-400 transition-colors">List Property</Link></li>
                <li><Link to="/landlord" className="hover:text-rose-400 transition-colors">Dashboard</Link></li>
                <li><Link to="/pricing" className="hover:text-rose-400 transition-colors">Pricing</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Contact</h4>
              <ul className="space-y-2 text-slate-400">
                <li className="flex items-center gap-2"><Mail className="w-4 h-4" /> kumarnikhil0180@gmail.com</li>
                <li className="flex items-center gap-2"><Phone className="w-4 h-4" /> +91 88516 33454</li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-800 mt-12 pt-8 text-center text-slate-500">
            <p>© 2025 RentKr. All rights reserved.</p>
          </div>
        </div>
      </footer>

      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode={authMode}
        setMode={setAuthMode}
      />
    </div>
  );
};

// Property Card Component
const PropertyCard = ({ property, index = 0 }) => {
  const navigate = useNavigate();
  const { isSaved, toggleSaved } = useSavedProperties();
  const images = [
    "https://images.unsplash.com/photo-1663756915301-2ba688e078cf?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
    "https://images.unsplash.com/photo-1696237461860-630be53f179c?crop=entropy&cs=srgb&fm=jpg&q=85&w=800",
    "https://images.unsplash.com/photo-1628592102751-ba83b0314276?crop=entropy&cs=srgb&fm=jpg&q=85&w=800"
  ];

  const saved = isSaved(property.property_id);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      viewport={{ once: true }}
      whileHover={{ y: -4 }}
      className="property-card group cursor-pointer"
      onClick={() => navigate(`/property/${property.property_id}`)}
      data-testid={`property-card-${property.property_id}`}
    >
      <Card className="overflow-hidden border-slate-200 hover:border-rose-200 transition-all hover:shadow-xl">
        <div className="relative aspect-[4/3] overflow-hidden">
          <img
            src={property.images?.[0] || images[index % 3]}
            alt={property.title}
            className="property-image w-full h-full object-cover"
          />
          <div className="absolute top-4 left-4 flex gap-2">
            {property.is_verified && (
              <Badge className="bg-teal-500 text-white border-0">
                <BadgeCheck className="w-3 h-3 mr-1" /> Property Verified
              </Badge>
            )}
            {!property.is_verified && property.landlord_verified && (
              <Badge className="bg-rose-500 text-white border-0">
                <Shield className="w-3 h-3 mr-1" /> Verified Landlord
              </Badge>
            )}
            {property.is_premium && (
              <Badge className="bg-amber-500 text-white border-0">
                <Star className="w-3 h-3 mr-1" /> Premium
              </Badge>
            )}
          </div>
          <button
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/80 backdrop-blur flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleSaved(property.property_id);
              toast.success(saved ? "Removed from saved" : "Saved to favorites");
            }}
            aria-label={saved ? "Remove from saved" : "Save property"}
          >
            <Heart className={`w-4 h-4 ${saved ? "text-rose-600 fill-rose-600" : "text-slate-600"}`} />
          </button>
        </div>

        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="font-semibold text-slate-900 group-hover:text-rose-600 transition-colors line-clamp-1">
                {property.title}
              </h3>
              <p className="text-sm text-slate-500 flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" /> {property.location}, {property.city}
              </p>
            </div>
            {property.ai_match_score && (
              <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                <Sparkles className="w-3 h-3 mr-1" /> {property.ai_match_score}%
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-slate-500 mb-4">
            <span className="flex items-center gap-1"><Bed className="w-4 h-4" /> {property.bedrooms}</span>
            <span className="flex items-center gap-1"><Bath className="w-4 h-4" /> {property.bathrooms}</span>
            <span className="flex items-center gap-1"><Square className="w-4 h-4" /> {property.area_sqft} sqft</span>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-slate-900">
              ₹{property.rent?.toLocaleString()}<span className="text-sm font-normal text-slate-500">/month</span>
            </p>
            <Badge variant="outline" className="capitalize">{property.property_type}</Badge>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

// Properties Page
const PropertiesPage = () => {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    city: "",
    min_rent: "",
    max_rent: "",
    property_type: "",
    furnishing: "",
    bedrooms: ""
  });

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.append(key, value);
      });

      const response = await axios.get(`${API}/properties?${params.toString()}`);
      setProperties(response.data);
    } catch (error) {
      toast.error("Failed to load properties");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchProperties();
  }, [fetchProperties]);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchProperties();
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-manrope font-bold text-slate-900 mb-2">Find Your Home</h1>
          <p className="text-slate-600">Browse verified rental properties across India</p>
        </div>

        {/* Filters */}
        <Card className="mb-8">
          <CardContent className="p-6">
            <form onSubmit={handleSearch} className="grid md:grid-cols-6 gap-4">
              <div>
                <Label className="mb-2 block">City</Label>
                <Input
                  placeholder="e.g. Bangalore"
                  value={filters.city}
                  onChange={(e) => setFilters({ ...filters, city: e.target.value })}
                  data-testid="filter-city"
                />
              </div>
              <div>
                <Label className="mb-2 block">Min Rent</Label>
                <Input
                  type="number"
                  placeholder="₹5,000"
                  value={filters.min_rent}
                  onChange={(e) => setFilters({ ...filters, min_rent: e.target.value })}
                  data-testid="filter-min-rent"
                />
              </div>
              <div>
                <Label className="mb-2 block">Max Rent</Label>
                <Input
                  type="number"
                  placeholder="₹50,000"
                  value={filters.max_rent}
                  onChange={(e) => setFilters({ ...filters, max_rent: e.target.value })}
                  data-testid="filter-max-rent"
                />
              </div>
              <div>
                <Label className="mb-2 block">Type</Label>
                <Select value={filters.property_type || "all"} onValueChange={(v) => setFilters({ ...filters, property_type: v === "all" ? "" : v })}>
                  <SelectTrigger data-testid="filter-type">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="apartment">Apartment</SelectItem>
                    <SelectItem value="house">House</SelectItem>
                    <SelectItem value="villa">Villa</SelectItem>
                    <SelectItem value="studio">Studio</SelectItem>
                    <SelectItem value="pg">PG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-2 block">Furnishing</Label>
                <Select value={filters.furnishing || "any"} onValueChange={(v) => setFilters({ ...filters, furnishing: v === "any" ? "" : v })}>
                  <SelectTrigger data-testid="filter-furnishing">
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="furnished">Furnished</SelectItem>
                    <SelectItem value="semi-furnished">Semi-Furnished</SelectItem>
                    <SelectItem value="unfurnished">Unfurnished</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-700" data-testid="search-btn">
                  <Search className="w-4 h-4 mr-2" /> Search
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Results */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse">
                <div className="aspect-[4/3] bg-slate-200" />
                <CardContent className="p-5 space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                  <div className="h-6 bg-slate-200 rounded w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : properties.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {properties.map((property, i) => (
              <PropertyCard key={property.property_id} property={property} index={i} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No properties found</h3>
            <p className="text-slate-600">Try adjusting your filters</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Property Detail Page
const PropertyDetailPage = () => {
  const { id } = require("react-router-dom").useParams();
  const [property, setProperty] = useState(null);
  const [matchScore, setMatchScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSaved, toggleSaved } = useSavedProperties();
  const { contactLandlord } = useMessaging();
  const [contactOpen, setContactOpen] = useState(false);
  const [landlordProfile, setLandlordProfile] = useState(null);
  const [landlordLoading, setLandlordLoading] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  useEffect(() => {
    const fetchProperty = async () => {
      try {
        const response = await axios.get(`${API}/properties/${id}`);
        setProperty(response.data);

        // Get AI match score
        try {
          const matchRes = await axios.post(`${API}/ai/match-score`, { property_id: id });
          setMatchScore(matchRes.data);
        } catch (e) { }
      } catch (error) {
        toast.error("Property not found");
        navigate("/properties");
      } finally {
        setLoading(false);
      }
    };
    fetchProperty();
  }, [id, navigate]);

  const saved = property ? isSaved(property.property_id) : false;

  const openContact = async () => {
    if (!user || user.user_type !== "tenant") {
      toast.error("Please log in as a tenant to contact landlords.");
      return;
    }
    setContactOpen(true);
    if (!property?.landlord_id) return;

    setLandlordLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API}/users/${property.landlord_id}/public`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLandlordProfile(res.data);
    } catch (e) {
      setLandlordProfile(null);
    } finally {
      setLandlordLoading(false);
    }
  };

  const [showEditModal, setShowEditModal] = useState(false);
  const isOwner = user?.user_type === "landlord" && user?.user_id === property?.landlord_id;

  const toggleStatus = async () => {
    try {
      const token = localStorage.getItem("token");
      const newStatus = !property.is_active;
      await axios.patch(`${API}/properties/${property.property_id}/status`,
        { is_active: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setProperty(prev => ({ ...prev, is_active: newStatus }));
      toast.success(newStatus ? "Property activated" : "Property deactivated");
    } catch (e) {
      toast.error("Failed to update status");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-600" />
      </div>
    );
  }

  if (!property) return null;

  const images = [
    "https://images.unsplash.com/photo-1663756915301-2ba688e078cf?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
    "https://images.unsplash.com/photo-1696237461860-630be53f179c?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200"
  ];

  const displayImages = property.images && property.images.length > 0 ? property.images : images;

  const nextImage = () => setCurrentImageIndex((prev) => (prev + 1) % displayImages.length);
  const prevImage = () => setCurrentImageIndex((prev) => (prev - 1 + displayImages.length) % displayImages.length);

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-8">
            {/* Images */}
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden aspect-video group bg-black">
                <img
                  src={displayImages[currentImageIndex]}
                  alt={property.title}
                  className="w-full h-full object-contain"
                />

                {/* Navigation Buttons */}
                {displayImages.length > 1 && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); prevImage(); }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); nextImage(); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 hover:bg-white text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>

                    {/* Dots indicator */}
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                      {displayImages.map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-2 h-2 rounded-full transition-all ${currentImageIndex === idx ? "bg-white w-4" : "bg-white/50"}`}
                        />
                      ))}
                    </div>
                  </>
                )}

                <div className="absolute top-4 left-4 flex gap-2">
                  <div className="flex gap-2">
                    {property.is_verified && (
                      <Badge className="bg-teal-500 text-white">
                        <BadgeCheck className="w-3 h-3 mr-1" /> Verified Property
                      </Badge>
                    )}
                    {property.landlord_verified && (
                      <Badge className="bg-rose-600 text-white">
                        <Shield className="w-3 h-3 mr-1" /> Verified Landlord
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Thumbnails */}
              {displayImages.length > 1 && (
                <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
                  {displayImages.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentImageIndex(idx)}
                      className={`relative w-24 aspect-video rounded-lg overflow-hidden flex-shrink-0 transition-all ${currentImageIndex === idx ? "ring-2 ring-rose-600 ring-offset-2" : "opacity-70 hover:opacity-100"
                        }`}
                    >
                      <img src={img} alt={`Thumbnail ${idx}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <Card>
              <CardContent className="p-8">
                <h1 className="text-3xl font-manrope font-bold text-slate-900 mb-4">{property.title}</h1>

                <div className="flex items-center gap-2 text-slate-600 mb-6">
                  <MapPin className="w-5 h-5 text-rose-500" />
                  <span>{property.location}, {property.city}</span>
                </div>

                <div className="grid grid-cols-4 gap-6 py-6 border-y border-slate-200">
                  <div className="text-center">
                    <Bed className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                    <p className="font-semibold text-slate-900">{property.bedrooms}</p>
                    <p className="text-sm text-slate-500">Bedrooms</p>
                  </div>
                  <div className="text-center">
                    <Bath className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                    <p className="font-semibold text-slate-900">{property.bathrooms}</p>
                    <p className="text-sm text-slate-500">Bathrooms</p>
                  </div>
                  <div className="text-center">
                    <Square className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                    <p className="font-semibold text-slate-900">{property.area_sqft}</p>
                    <p className="text-sm text-slate-500">Sq. Ft.</p>
                  </div>
                  <div className="text-center">
                    <Building className="w-6 h-6 mx-auto text-slate-400 mb-2" />
                    <p className="font-semibold text-slate-900 capitalize">{property.property_type}</p>
                    <p className="text-sm text-slate-500">Type</p>
                  </div>
                </div>

                <div className="py-6">
                  <h3 className="font-semibold text-slate-900 mb-4">Description</h3>
                  <p className="text-slate-600 leading-relaxed">{property.description}</p>
                </div>

                {property.amenities?.length > 0 && (
                  <div className="py-6 border-t border-slate-200">
                    <h3 className="font-semibold text-slate-900 mb-4">Amenities</h3>
                    <div className="flex flex-wrap gap-2">
                      {property.amenities.map((amenity, i) => (
                        <Badge key={i} variant="secondary">{amenity}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Price Card */}
            <Card className="sticky top-24">
              <CardContent className="p-6">
                <div className="text-center mb-6">
                  <p className="text-sm text-slate-500 mb-1">Monthly Rent</p>
                  <p className="text-4xl font-bold text-slate-900">
                    ₹{property.rent?.toLocaleString()}
                  </p>
                </div>

                {matchScore && (
                  <div className="bg-rose-50 rounded-xl p-4 mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-rose-700 font-medium flex items-center gap-1">
                        <Sparkles className="w-4 h-4" /> AI Match Score
                      </span>
                      <span className="text-2xl font-bold text-rose-600">{matchScore.match_score}%</span>
                    </div>
                    <p className="text-sm text-rose-600">{matchScore.recommendation}</p>
                  </div>
                )}

                {isOwner ? (
                  <div className="space-y-3">
                    <Button
                      className="w-full bg-slate-900 hover:bg-slate-800"
                      onClick={() => setShowEditModal(true)}
                    >
                      Edit Property
                    </Button>
                    <Button
                      variant="outline"
                      className={`w-full ${!property.is_active ? "text-green-600 border-green-200 bg-green-50" : "text-amber-600 border-amber-200 bg-amber-50"}`}
                      onClick={toggleStatus}
                    >
                      {property.is_active ? "Disable Property" : "Activate Property"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      className="w-full bg-rose-600 hover:bg-rose-700 mb-3"
                      onClick={openContact}
                      data-testid="contact-landlord"
                    >
                      <Phone className="w-4 h-4 mr-2" /> Contact Landlord
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        toggleSaved(property.property_id);
                        toast.success(saved ? "Removed from saved" : "Saved to favorites");
                      }}
                    >
                      <Heart className={`w-4 h-4 mr-2 ${saved ? "text-rose-600 fill-rose-600" : ""}`} />
                      {saved ? "Saved" : "Save Property"}
                    </Button>
                  </>
                )}

                <div className="mt-6 pt-6 border-t border-slate-200">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Furnishing</span>
                    <span className="font-medium capitalize">{property.furnishing}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-slate-500">Available From</span>
                    <span className="font-medium">{property.available_from}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-2xl font-manrope">Contact landlord</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm text-slate-500 mb-1">Property</p>
              <p className="font-semibold text-slate-900">{property?.title}</p>
              <p className="text-sm text-slate-600 flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" /> {property?.location}, {property?.city}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <p className="text-sm text-slate-500 mb-2">Landlord</p>
              {landlordLoading ? (
                <div className="flex items-center gap-3 text-slate-600">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-rose-600" />
                  Loading contact details...
                </div>
              ) : landlordProfile ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{landlordProfile.name}</p>
                    {landlordProfile.is_verified && (
                      <Badge className="bg-teal-500 text-white border-0">
                        <BadgeCheck className="w-3 h-3 mr-1" /> Verified
                      </Badge>
                    )}
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Phone className="w-4 h-4 text-rose-600" />
                      <span>{landlordProfile.phone || "Phone not shared"}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-600">
                      <Mail className="w-4 h-4 text-rose-600" />
                      <span className="truncate">{landlordProfile.email}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={!landlordProfile.phone}
                      onClick={() => {
                        if (landlordProfile.phone) window.location.href = `tel:${landlordProfile.phone}`;
                      }}
                    >
                      <Phone className="w-4 h-4 mr-2" /> Call
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        window.location.href = `mailto:${landlordProfile.email}?subject=${encodeURIComponent(`RentKr inquiry: ${property?.title || "Property"}`)}`;
                      }}
                    >
                      <Mail className="w-4 h-4 mr-2" /> Email
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  Contact details are temporarily unavailable. You can still send an in-app message.
                </p>
              )}
            </div>

            <div>
              <Label>Message</Label>
              <Textarea
                value={contactMessage}
                onChange={(e) => setContactMessage(e.target.value)}
                placeholder="Hi, I'm interested in this property. Is it still available?"
                rows={4}
              />
              <div className="flex gap-2 mt-3">
                <Button
                  className="flex-1 bg-rose-600 hover:bg-rose-700"
                  onClick={async () => {
                    try {
                      if (!contactMessage.trim()) {
                        toast.error("Please enter a message");
                        return;
                      }

                      const threadId = await contactLandlord(property.property_id, contactMessage);
                      setContactOpen(false);
                      setContactMessage("");
                      toast.success("Message sent!");
                      navigate(`/tenant/messages?thread=${encodeURIComponent(threadId)}`);
                    } catch (e) {
                      toast.error("Failed to send message properly. Try again.");
                    }
                  }}
                >
                  <Send className="w-4 h-4 mr-2" /> Send Message
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => setContactOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AddPropertyModal
        open={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSuccess={() => {
          setShowEditModal(false);
          // Reload property data
          axios.get(`${API}/properties/${id}`).then(res => setProperty(res.data));
        }}
        initialData={property}
      />
    </div>
  );
};

// Saved Properties Page (Tenant)
const SavedPropertiesPage = () => {
  const { savedIds, toggleSaved } = useSavedProperties();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const uniqueIds = Array.from(new Set(savedIds));
        if (uniqueIds.length === 0) {
          setItems([]);
          return;
        }
        const results = await Promise.allSettled(
          uniqueIds.map((pid) => axios.get(`${API}/properties/${pid}`).then((r) => r.data))
        );
        const ok = results
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);
        setItems(ok);
      } catch (e) {
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [savedIds]);

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-3xl font-manrope font-bold text-slate-900">Saved Properties</h1>
            <p className="text-slate-600">Your favorites, ready when you are.</p>
          </div>
          <Button variant="outline" onClick={() => navigate("/properties")}>
            Browse <ChevronRight className="ml-1 w-4 h-4" />
          </Button>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <div className="aspect-[4/3] bg-slate-200" />
                <CardContent className="p-5 space-y-3">
                  <div className="h-5 bg-slate-200 rounded w-3/4" />
                  <div className="h-4 bg-slate-200 rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {items.map((property, i) => (
              <div key={property.property_id} className="relative">
                <PropertyCard property={property} index={i} />
                <Button
                  size="sm"
                  variant="outline"
                  className="absolute bottom-4 right-4 bg-white/90 backdrop-blur"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleSaved(property.property_id);
                    toast.success("Removed from saved");
                  }}
                >
                  <Heart className="w-4 h-4 mr-2 text-rose-600 fill-rose-600" /> Remove
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center">
            <Heart className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-slate-900 mb-2">No saved properties yet</h3>
            <p className="text-slate-600 mb-6">Tap the heart on any property to save it here.</p>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => navigate("/properties")}>
              Find a home
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
};

// Messages Page (Universal)
const MessagesPage = () => {
  const { user } = useAuth();
  const { threads, sendMessage } = useMessaging();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedThreadId, setSelectedThreadId] = useState(searchParams.get("thread") || "");
  const [draft, setDraft] = useState("");
  const threadParam = searchParams.get("thread") || "";

  const threadIds = Object.keys(threads || {}).sort((a, b) => {
    const ta = new Date(threads[a]?.last_updated || 0).getTime();
    const tb = new Date(threads[b]?.last_updated || 0).getTime();
    return tb - ta;
  });

  useEffect(() => {
    if (threadParam && threadParam !== selectedThreadId) setSelectedThreadId(threadParam);
    if (!threadParam && selectedThreadId) setSearchParams({ thread: selectedThreadId });
  }, [threadParam, selectedThreadId, setSearchParams]);

  const active = selectedThreadId ? threads[selectedThreadId] : null;

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h1 className="text-3xl font-manrope font-bold text-slate-900">Messages</h1>
            <p className="text-slate-600">
              {user?.user_type === "tenant"
                ? "Chat directly with landlords—broker-free."
                : "Communicate with prospective tenants."}
            </p>
          </div>
          {user?.user_type === "tenant" ? (
            <Button variant="outline" onClick={() => navigate("/properties")}>
              Find properties <ChevronRight className="ml-1 w-4 h-4" />
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate("/landlord")}>
              <ArrowRight className="mr-1 w-4 h-4 rotate-180" /> Dashboard
            </Button>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardContent className="p-4">
              <div className="space-y-2">
                {threadIds.length === 0 ? (
                  <div className="text-center py-10">
                    <MessageCircle className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <p className="font-semibold text-slate-900">No conversations yet</p>
                    <p className="text-sm text-slate-600 mt-1">
                      {user?.user_type === "tenant"
                        ? "Open any property and contact the landlord."
                        : "Messages from interested tenants will appear here."}
                    </p>
                  </div>
                ) : (
                  threadIds.map((id) => {
                    const t = threads[id];
                    const isActive = id === selectedThreadId;
                    const last = (t?.messages || [])[t?.messages?.length - 1];
                    const otherPartyName = user?.user_type === "tenant" ? (t?.landlord_name || "Landlord") : (t?.tenant_name || "Tenant");

                    return (
                      <button
                        key={id}
                        className={`w-full text-left rounded-xl border p-4 transition-colors ${isActive ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white hover:border-rose-200"
                          }`}
                        onClick={() => {
                          setSelectedThreadId(id);
                          setSearchParams({ thread: id });
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-slate-900 line-clamp-1">{t?.property_title || "Property"}</p>
                            <p className="text-xs text-rose-600 font-medium mb-1 line-clamp-1">{otherPartyName}</p>
                            <p className="text-sm text-slate-600 line-clamp-1">{last?.content || "Start the conversation"}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-slate-400 mt-1" />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardContent className="p-0">
              {!active ? (
                <div className="p-10 text-center">
                  <MessageCircle className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">Select a conversation</h3>
                  <p className="text-slate-600">Your messages will appear here.</p>
                </div>
              ) : (
                <div className="flex flex-col h-[520px]">
                  <div className="p-5 border-b border-slate-200 bg-white rounded-t-lg flex justify-between items-center">
                    <div>
                      <p className="text-sm text-slate-500">Property</p>
                      <p className="font-semibold text-slate-900">{active.property_title}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-500">{user?.user_type === "tenant" ? "Landlord" : "Tenant"}</p>
                      <p className="font-semibold text-rose-600">
                        {user?.user_type === "tenant" ? active.landlord_name : active.tenant_name}
                      </p>
                    </div>
                  </div>

                  <div className="flex-1 p-5 space-y-3 overflow-y-auto bg-slate-50">
                    {(active.messages || []).length === 0 ? (
                      <div className="text-center text-slate-600 pt-10">
                        No messages yet.
                      </div>
                    ) : (
                      (active.messages || []).map((m) => {
                        const isMe = m.role === user?.user_type;
                        return (
                          <div key={m.id} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe
                                ? "bg-rose-600 text-white rounded-br-none"
                                : "bg-white border border-slate-200 text-slate-800 rounded-bl-none"
                                }`}
                            >
                              {m.content}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="p-4 border-t border-slate-200 bg-white rounded-b-lg">
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (!draft.trim()) return;
                        await sendMessage(selectedThreadId, draft);
                        setDraft("");
                      }}
                      className="flex gap-2"
                    >
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Write a message…"
                      />
                      <Button type="submit" className="bg-rose-600 hover:bg-rose-700" disabled={!draft.trim()}>
                        <Send className="w-4 h-4" />
                      </Button>
                    </form>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

// Contact Page
const ContactPage = () => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const submit = (e) => {
    e.preventDefault();
    const subject = `RentKr inquiry from ${name || "someone"}`;
    const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
    window.location.href = `mailto:support@rentkr.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    toast.success("Opening your email client…");
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <Badge className="bg-rose-100 text-rose-700 mb-4">Support</Badge>
          <h1 className="text-4xl font-manrope font-bold text-slate-900 mb-3">Contact RentKr</h1>
          <p className="text-slate-600">
            Premium support for landlords and fast help for tenants—always broker-free.
          </p>
        </div>

        <Card>
          <CardContent className="p-8">
            <form onSubmit={submit} className="space-y-5">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Your name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" required />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" required />
                </div>
              </div>
              <div>
                <Label>Message</Label>
                <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6} placeholder="Tell us what you need help with…" required />
              </div>
              <Button type="submit" className="w-full bg-rose-600 hover:bg-rose-700">
                Send message
              </Button>
              <div className="text-sm text-slate-500 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-rose-600" /> support@rentkr.com
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4 text-rose-600" /> +91 98765 43210
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Tenant Dashboard
const TenantDashboard = () => {
  const { user, checkAuth } = useAuth();
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchRecommendations = async () => {
      try {
        const token = localStorage.getItem("token");
        const response = await axios.get(`${API}/ai/recommendations`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setRecommendations(response.data.recommendations || []);
      } catch (e) {
        // Fetch featured properties as fallback
        try {
          const res = await axios.get(`${API}/properties/featured?limit=6`);
          setRecommendations(res.data);
        } catch (e) { }
      } finally {
        setLoading(false);
      }
    };
    fetchRecommendations();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pt-24" data-testid="tenant-dashboard">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-manrope font-bold text-slate-900">Welcome, {user?.name}</h1>
          <p className="text-slate-600">Find your perfect home with AI-powered recommendations</p>
        </div>

        <div className="mb-8">
          <VerificationSection user={user} refreshUser={() => checkAuth()} />
        </div>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card className="cursor-pointer hover:border-rose-200 transition-colors" onClick={() => navigate("/properties")}>
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center">
                <Search className="w-6 h-6 text-rose-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Search Properties</h3>
                <p className="text-sm text-slate-500">Browse all listings</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-rose-200 transition-colors"
            onClick={() => navigate("/tenant/saved")}
          >
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                <Heart className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Saved Properties</h3>
                <p className="text-sm text-slate-500">Your favorites</p>
              </div>
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer hover:border-rose-200 transition-colors"
            onClick={() => navigate("/tenant/messages")}
          >
            <CardContent className="p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">Messages</h3>
                <p className="text-sm text-slate-500">Chat with landlords</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Recommendations */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles className="w-5 h-5 text-rose-500" />
            <h2 className="text-2xl font-semibold text-slate-900">Recommended for You</h2>
          </div>

          {loading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <div className="aspect-[4/3] bg-slate-200" />
                  <CardContent className="p-5 space-y-3">
                    <div className="h-5 bg-slate-200 rounded w-3/4" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recommendations.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {recommendations.map((property, i) => (
                <PropertyCard key={property.property_id} property={property} index={i} />
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">No recommendations yet</h3>
              <p className="text-slate-600 mb-4">Start searching to get personalized suggestions</p>
              <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => navigate("/properties")}>
                Browse Properties
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

// Landlord Dashboard
const LandlordDashboard = () => {
  const { user, checkAuth } = useAuth();
  const [properties, setProperties] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const token = localStorage.getItem("token");
      const headers = { Authorization: `Bearer ${token}` };

      const [propertiesRes, subRes] = await Promise.all([
        axios.get(`${API}/properties/landlord/my-properties`, { headers }),
        axios.get(`${API}/subscriptions/my-subscription`, { headers })
      ]);

      setProperties(propertiesRes.data);
      setSubscription(subRes.data);
    } catch (e) {
      console.log("Error fetching data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pt-24" data-testid="landlord-dashboard">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-manrope font-bold text-slate-900">Landlord Dashboard</h1>
            <p className="text-slate-600">Manage your property listings</p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowAddProperty(true)}
            >
              <Plus className="w-4 h-4 mr-2" /> Add Property
            </Button>
          </div>
        </div>

        <div className="mb-8">
          <VerificationSection user={user} refreshUser={() => checkAuth()} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-12">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Listings</p>
                  <p className="text-3xl font-bold text-slate-900">{properties.length}</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-rose-100 flex items-center justify-center">
                  <Building2 className="w-6 h-6 text-rose-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Verified</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {properties.filter(p => p.is_verified).length}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                  <BadgeCheck className="w-6 h-6 text-teal-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Views</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {properties.reduce((sum, p) => sum + (p.views || 0), 0)}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-rose-200 transition-colors" onClick={() => navigate("/landlord/messages")}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Messages</p>
                  <p className="text-3xl font-bold text-slate-900">View</p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:border-rose-200 transition-colors" onClick={() => navigate("/pricing")}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Subscription</p>
                  <p className="text-lg font-bold text-slate-900">
                    {subscription?.is_active ? subscription.plan_name : "No Plan"}
                  </p>
                </div>
                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
                  <Star className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Properties List */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-slate-900 mb-6">My Properties</h2>

          {loading ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <div className="aspect-[4/3] bg-slate-200" />
                  <CardContent className="p-5 space-y-3">
                    <div className="h-5 bg-slate-200 rounded w-3/4" />
                    <div className="h-4 bg-slate-200 rounded w-1/2" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : properties.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {properties.map((property, i) => (
                <PropertyCard key={property.property_id} property={property} index={i} />
              ))}
            </div>
          ) : (
            <Card className="p-12 text-center">
              <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">No properties yet</h3>
              <p className="text-slate-600 mb-4">Start by adding your first property</p>
              <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => setShowAddProperty(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Property
              </Button>
            </Card>
          )}
        </div>
      </div>

      <AddPropertyModal
        open={showAddProperty}
        onClose={() => setShowAddProperty(false)}
        onSuccess={() => { setShowAddProperty(false); fetchData(); }}
      />
    </div>
  );
};

// Add Property Modal (Create & Edit)
const AddPropertyModal = ({ open, onClose, onSuccess, initialData = null }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    location: "",
    city: "",
    rent: "",
    property_type: "apartment",
    furnishing: "semi-furnished",
    bedrooms: "2",
    bathrooms: "2",
    area_sqft: "",
    amenities: [],
    available_from: "Immediate"
  });
  const [images, setImages] = useState([]);

  useEffect(() => {
    if (initialData) {
      setFormData({
        title: initialData.title || "",
        description: initialData.description || "",
        location: initialData.location || "",
        city: initialData.city || "",
        rent: initialData.rent || "",
        property_type: initialData.property_type || "apartment",
        furnishing: initialData.furnishing || "semi-furnished",
        bedrooms: initialData.bedrooms?.toString() || "2",
        bathrooms: initialData.bathrooms?.toString() || "2",
        area_sqft: initialData.area_sqft || "",
        amenities: initialData.amenities || [],
        available_from: initialData.available_from || "Immediate"
      });
      setImages(initialData.images || []);
    } else {
      setFormData({
        title: "",
        description: "",
        location: "",
        city: "",
        rent: "",
        property_type: "apartment",
        furnishing: "semi-furnished",
        bedrooms: "2",
        bathrooms: "2",
        area_sqft: "",
        amenities: [],
        available_from: "Immediate"
      });
      setImages([]);
    }
  }, [initialData, open]);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);

    // Validate size (client-side check optional but good UX)
    const validFiles = selectedFiles.filter(file => file.size <= 5 * 1024 * 1024);
    if (validFiles.length < selectedFiles.length) {
      toast.error("Some files were skipped (> 5MB)");
    }

    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImages(prev => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const setMainImage = (index) => {
    if (index === 0) return;
    setImages(prev => {
      const newImages = [...prev];
      const item = newImages.splice(index, 1)[0];
      newImages.unshift(item);
      return newImages;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const payload = {
        ...formData,
        rent: parseFloat(formData.rent),
        bedrooms: parseInt(formData.bedrooms),
        bathrooms: parseInt(formData.bathrooms),
        area_sqft: parseInt(formData.area_sqft),
        images: images
      };

      if (initialData) {
        await axios.put(`${API}/properties/${initialData.property_id}`, payload, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success("Property updated successfully!");
      } else {
        await axios.post(`${API}/properties`, payload, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success("Property listed successfully!");
      }

      onSuccess();
      onClose(); // Close modal
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save property");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-manrope">Add New Property</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label>Property Title</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g. Modern 2BHK in Koramangala"
                required
                data-testid="property-title"
              />
            </div>

            <div>
              <Label>City</Label>
              <Input
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                placeholder="e.g. Bangalore"
                required
                data-testid="property-city"
              />
            </div>

            <div>
              <Label>Location</Label>
              <Input
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="e.g. Koramangala 5th Block"
                required
                data-testid="property-location"
              />
            </div>

            <div>
              <Label>Monthly Rent (₹)</Label>
              <Input
                type="number"
                value={formData.rent}
                onChange={(e) => setFormData({ ...formData, rent: e.target.value })}
                placeholder="25000"
                required
                data-testid="property-rent"
              />
            </div>

            <div>
              <Label>Area (sq.ft)</Label>
              <Input
                type="number"
                value={formData.area_sqft}
                onChange={(e) => setFormData({ ...formData, area_sqft: e.target.value })}
                placeholder="1000"
                required
                data-testid="property-area"
              />
            </div>

            <div>
              <Label>Property Type</Label>
              <Select value={formData.property_type} onValueChange={(v) => setFormData({ ...formData, property_type: v })}>
                <SelectTrigger data-testid="property-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apartment">Apartment</SelectItem>
                  <SelectItem value="house">House</SelectItem>
                  <SelectItem value="villa">Villa</SelectItem>
                  <SelectItem value="studio">Studio</SelectItem>
                  <SelectItem value="pg">PG</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Furnishing</Label>
              <Select value={formData.furnishing} onValueChange={(v) => setFormData({ ...formData, furnishing: v })}>
                <SelectTrigger data-testid="property-furnishing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="furnished">Furnished</SelectItem>
                  <SelectItem value="semi-furnished">Semi-Furnished</SelectItem>
                  <SelectItem value="unfurnished">Unfurnished</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Bedrooms</Label>
              <Select value={formData.bedrooms} onValueChange={(v) => setFormData({ ...formData, bedrooms: v })}>
                <SelectTrigger data-testid="property-bedrooms">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 BHK</SelectItem>
                  <SelectItem value="2">2 BHK</SelectItem>
                  <SelectItem value="3">3 BHK</SelectItem>
                  <SelectItem value="4">4 BHK</SelectItem>
                  <SelectItem value="5">5+ BHK</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Bathrooms</Label>
              <Select value={formData.bathrooms} onValueChange={(v) => setFormData({ ...formData, bathrooms: v })}>
                <SelectTrigger data-testid="property-bathrooms">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1</SelectItem>
                  <SelectItem value="2">2</SelectItem>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4+</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="md:col-span-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe your property..."
                rows={4}
                required
                data-testid="property-description"
              />
            </div>
            {/* Photos */}
            <div className="md:col-span-2">
              <Label>Photos</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileChange}
                className="cursor-pointer mb-4"
              />

              {images.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 mt-4">
                  {images.map((src, index) => (
                    <div key={index} className="relative aspect-square rounded-lg overflow-hidden border border-slate-200 group">
                      <img src={src} alt={`Preview ${index}`} className="w-full h-full object-cover" />

                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        {index !== 0 && (
                          <button
                            type="button"
                            onClick={() => setMainImage(index)}
                            className="p-1.5 bg-white text-slate-900 rounded-full hover:bg-rose-50 hover:text-rose-600"
                            title="Set as Main"
                          >
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="p-1.5 bg-white text-red-600 rounded-full hover:bg-red-50"
                          title="Remove"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {index === 0 && (
                        <div className="absolute top-2 left-2 bg-rose-600 text-white text-xs px-2 py-1 rounded font-medium shadow-sm">
                          Main Photo
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-500 mt-2">
                Select multiple images. The first image is the main cover photo.
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-rose-600 hover:bg-rose-700" disabled={loading} data-testid="submit-property">
              {loading ? "Saving..." : (initialData ? "Save Changes" : "List Property")}
            </Button>
          </div>
        </form>
      </DialogContent >
    </Dialog >
  );
};

// Pricing Page
const PricingPage = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const navigate = useNavigate();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const response = await axios.get(`${API}/subscriptions/plans`);
        setPlans(response.data);
      } catch (e) {
        // Fallback plans
        setPlans([
          { plan_id: "basic_2w", name: "Basic - 2 Weeks", duration_days: 14, price: 499, features: ["List 1 property", "Basic visibility", "Email support"] },
          { plan_id: "standard_1m", name: "Standard - 1 Month", duration_days: 30, price: 899, features: ["List 3 properties", "Enhanced visibility", "Priority support", "Analytics"] },
          { plan_id: "premium_3m", name: "Premium - 3 Months", duration_days: 90, price: 1999, features: ["Unlimited properties", "Premium badge", "Top placement", "Dedicated support", "Advanced analytics"] }
        ]);
      } finally {
        setLoading(false);
      }
    };
    fetchPlans();
  }, []);

  const handleSubscribe = async (planId) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (user.user_type !== "landlord") {
      toast.error("Only landlords can purchase subscriptions");
      return;
    }

    setCheckoutLoading(planId);
    try {
      const token = localStorage.getItem("token");
      const response = await axios.post(`${API}/payments/checkout`, {
        plan_id: planId,
        origin_url: window.location.origin
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      window.location.href = response.data.url;
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to initiate checkout");
    } finally {
      setCheckoutLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pt-24">
      <div className="max-w-6xl mx-auto px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <Badge className="bg-rose-100 text-rose-700 mb-4">Pricing for Landlords</Badge>
          <h1 className="text-4xl md:text-5xl font-manrope font-bold text-slate-900 mb-4">
            List Your Property
          </h1>
          <p className="text-xl text-slate-600 max-w-2xl mx-auto">
            Choose a plan that suits your needs. Tenants search for free.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.plan_id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Card className={`h-full ${i === 1 ? "border-rose-300 shadow-lg shadow-rose-100" : ""}`}>
                {i === 1 && (
                  <div className="bg-rose-600 text-white text-center py-2 text-sm font-medium rounded-t-lg">
                    Most Popular
                  </div>
                )}
                <CardContent className="p-8">
                  <h3 className="text-xl font-semibold text-slate-900 mb-2">{plan.name}</h3>
                  <p className="text-4xl font-bold text-slate-900 mb-6">
                    ₹{plan.price}<span className="text-base font-normal text-slate-500">/{plan.duration_days} days</span>
                  </p>

                  <ul className="space-y-3 mb-8">
                    {plan.features.map((feature, j) => (
                      <li key={j} className="flex items-center gap-2 text-slate-600">
                        <CheckCircle2 className="w-5 h-5 text-teal-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Button
                    className={`w-full ${i === 1 ? "bg-rose-600 hover:bg-rose-700" : ""}`}
                    variant={i === 1 ? "default" : "outline"}
                    onClick={() => handleSubscribe(plan.plan_id)}
                    disabled={checkoutLoading === plan.plan_id}
                    data-testid={`subscribe-${plan.plan_id}`}
                  >
                    {checkoutLoading === plan.plan_id ? "Processing..." : "Get Started"}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="text-slate-600">
            Need a custom plan for multiple properties? <Link to="/contact" className="text-rose-600 font-medium">Contact us</Link>
          </p>
        </div>
      </div>

      <AuthModal
        open={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        mode="register"
        setMode={() => { }}
      />
    </div>
  );
};

// Subscription Success Page
const SubscriptionSuccessPage = () => {
  const [status, setStatus] = useState("loading");
  const [paymentStatus, setPaymentStatus] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const checkPayment = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("session_id");

      if (!sessionId) {
        setStatus("error");
        return;
      }

      try {
        const token = localStorage.getItem("token");
        const response = await axios.get(`${API}/payments/status/${sessionId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        setPaymentStatus(response.data);
        setStatus(response.data.payment_status === "paid" ? "success" : "pending");
      } catch (e) {
        setStatus("error");
      }
    };

    checkPayment();
    // Poll for status
    const interval = setInterval(checkPayment, 2000);
    setTimeout(() => clearInterval(interval), 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pt-24 flex items-center justify-center">
      <Card className="max-w-md w-full mx-4">
        <CardContent className="p-8 text-center">
          {status === "loading" && (
            <>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">Processing Payment...</h2>
              <p className="text-slate-600">Please wait while we confirm your payment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <div className="w-16 h-16 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8 text-teal-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Successful!</h2>
              <p className="text-slate-600 mb-6">Your subscription is now active. You can start listing properties.</p>
              <Button className="bg-rose-600 hover:bg-rose-700" onClick={() => navigate("/landlord")}>
                Go to Dashboard
              </Button>
            </>
          )}

          {status === "pending" && (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
                <Clock className="w-8 h-8 text-amber-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Pending</h2>
              <p className="text-slate-600 mb-6">Your payment is being processed. This may take a few moments.</p>
              <Button variant="outline" onClick={() => navigate("/landlord")}>
                Go to Dashboard
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                <X className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Failed</h2>
              <p className="text-slate-600 mb-6">Something went wrong. Please try again.</p>
              <Button variant="outline" onClick={() => navigate("/pricing")}>
                Try Again
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Protected Route
const ProtectedRoute = ({ children, allowedTypes = [] }) => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) {
      navigate("/", { replace: true });
    }

    if (!loading && user && allowedTypes.length > 0 && !allowedTypes.includes(user.user_type)) {
      navigate(user.user_type === "landlord" ? "/landlord" : "/tenant", { replace: true });
    }
  }, [user, loading, navigate, allowedTypes]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rose-600" />
      </div>
    );
  }

  if (!user) return null;

  if (allowedTypes.length > 0 && !allowedTypes.includes(user.user_type)) return null;

  return children;
};

// ================== PROFILE & ADMIN COMPONENTS ==================

const ProfileModal = ({ open, onClose, user, onUpdate }) => {
  const [formData, setFormData] = useState({
    name: user?.name || "",
    phone: user?.phone || "",
    picture: user?.picture || ""
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) setFormData({ name: user.name || "", phone: user.phone || "", picture: user.picture || "" });
  }, [user, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.put(`${API}/users/me`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      onUpdate(res.data);
      toast.success("Profile updated");
      onClose();
    } catch (e) {
      toast.error("Update failed");
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div><Label>Name</Label><Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required /></div>
          <div><Label>Phone</Label><Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></div>
          <div><Label>Profile Picture URL</Label><Input value={formData.picture} onChange={e => setFormData({ ...formData, picture: e.target.value })} /></div>
          <Button type="submit" className="w-full bg-rose-600" disabled={loading}>{loading ? "Saving..." : "Save Changes"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const VerificationSection = ({ user, refreshUser }) => {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFile = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(f => {
      const r = new FileReader();
      r.onloadend = () => setDocs(p => [...p, r.result]);
      r.readAsDataURL(f);
    });
  };

  const submit = async () => {
    if (docs.length === 0) return toast.error("Please upload documents");
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      await axios.post(`${API}/users/me/verify`, { documents: docs }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Submitted for review");
      refreshUser();
    } catch (e) { toast.error("Submission failed"); } finally { setLoading(false); }
  };

  if (user.verification_status === "verified") return (
    <div className="p-6 bg-teal-50 border border-teal-200 rounded-2xl flex items-center gap-4 text-teal-800">
      <BadgeCheck className="w-10 h-10 text-teal-600" />
      <div><h3 className="font-bold">Account Verified</h3><p className="text-sm">Trusted status active.</p></div>
    </div>
  );

  if (user.verification_status === "pending") return (
    <div className="p-6 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-4 text-amber-800">
      <Clock className="w-10 h-10 text-amber-600" />
      <div><h3 className="font-bold">Verification Pending</h3><p className="text-sm">Admin is reviewing your IDs.</p></div>
    </div>
  );

  if (user.verification_status === "rejected") return (
    <Card className="border-rose-200 bg-rose-50/50 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-3 text-rose-700 mb-2">
          <AlertCircle className="w-5 h-5 text-rose-600" />
          <CardTitle className="text-lg">Verification Rejected</CardTitle>
        </div>
        <CardDescription className="text-rose-600">
          Your documents were not accepted. Please upload clear photos of your valid ID (Aadhar/PAN) and submit again.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="file" multiple onChange={handleFile} accept="image/*" />
        <div className="flex gap-2 flex-wrap">
          {docs.map((d, i) => (
            <div key={i} className="relative w-16 h-16 rounded overflow-hidden border border-slate-200 shadow-sm">
              <img src={d} alt="" className="w-full h-full object-cover" />
              <button
                onClick={(e) => { e.preventDefault(); setDocs(docs.filter((_, idx) => idx !== i)); }}
                className="absolute top-0 right-0 bg-rose-600 text-white p-0.5 hover:bg-rose-700 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <Button onClick={submit} className="bg-rose-600 w-full hover:bg-rose-700" disabled={loading || docs.length === 0}>
          {loading ? "Uploading..." : "Re-submit Documents"}
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <Card className="border-rose-100 bg-rose-50/30">
      <CardHeader>
        <CardTitle className="text-lg">Verify Your Account</CardTitle>
        <CardDescription>Upload Aadhar/PAN to unlock verified badge</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input type="file" multiple onChange={handleFile} accept="image/*" />
        <div className="flex gap-2 flex-wrap">
          {docs.map((d, i) => (
            <div key={i} className="relative w-16 h-16 rounded overflow-hidden border border-slate-200">
              <img src={d} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setDocs(docs.filter((_, idx) => idx !== i))} className="absolute top-0 right-0 bg-rose-600 text-white p-0.5">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <Button onClick={submit} className="bg-rose-600 w-full" disabled={loading || docs.length === 0}>
          {loading ? "Uploading..." : "Submit Documents"}
        </Button>
      </CardContent>
    </Card>
  );
};

const AdminDashboard = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API}/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(res.data);
    } catch (e) { toast.error("Failed to load users"); } finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const toggleStatus = async (uid) => {
    try {
      const token = localStorage.getItem("token");
      await axios.post(`${API}/admin/users/${uid}/toggle-status`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchUsers();
      toast.success("Status updated");
    } catch (e) { toast.error("Failed"); }
  };

  const verify = async (uid, status) => {
    try {
      const token = localStorage.getItem("token");
      await axios.post(`${API}/admin/users/${uid}/verify`, { status }, { headers: { Authorization: `Bearer ${token}` } });
      fetchUsers();
      toast.success(status);
    } catch (e) { toast.error("Failed"); }
  };

  if (loading) return <div className="pt-32 text-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-600 mx-auto" /></div>;

  return (
    <div className="min-h-screen bg-slate-100 pt-24">
      <div className="max-w-7xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">Admin Dashboard</h1>

        <Tabs defaultValue="all">
          <TabsList className="bg-white border border-slate-200 p-1 mb-6">
            <TabsTrigger value="all">All Users ({users.length})</TabsTrigger>
            <TabsTrigger value="pending">Pending ({users.filter(u => u.verification_status === "pending").length})</TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <UserList users={users} onToggle={toggleStatus} onVerify={verify} />
          </TabsContent>
          <TabsContent value="pending">
            <UserList users={users.filter(u => u.verification_status === "pending")} onToggle={toggleStatus} onVerify={verify} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

const UserList = ({ users, onToggle, onVerify }) => (
  <div className="grid gap-4">
    {users.map(u => (
      <Card key={u.user_id} className={u.is_disabled ? "opacity-60 bg-slate-50 border-red-200" : ""}>
        <CardContent className="p-6 flex items-center justify-between gap-6 flex-wrap md:flex-nowrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center font-bold text-rose-600">
              {u.name.charAt(0)}
            </div>
            <div>
              <p className="font-bold text-slate-900">{u.name} <Badge variant="outline" className="ml-2 font-normal capitalize">{u.user_type}</Badge></p>
              <p className="text-sm text-slate-500">{u.email}</p>
            </div>
          </div>

          <div className="flex-1">
            <p className="text-xs text-slate-500 uppercase mb-2">Documents</p>
            <div className="flex gap-2">
              {u.verification_docs?.map((d, i) => (
                <a key={i} href={d} target="_blank" rel="noreferrer" className="w-10 h-10 border rounded overflow-hidden">
                  <img src={d} className="w-full h-full object-cover" />
                </a>
              )) || "No docs"}
            </div>
          </div>

          <div className="flex gap-2">
            {u.verification_status === "pending" && (
              <>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => onVerify(u.user_id, "verified")}>Verify</Button>
                <Button size="sm" variant="outline" className="text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => onVerify(u.user_id, "rejected")}>Reject</Button>
              </>
            )}
            <Button size="sm" variant={u.is_disabled ? "default" : "destructive"} onClick={() => onToggle(u.user_id)}>
              {u.is_disabled ? "Enable" : "Disable"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-slate-400 hover:text-rose-600 hover:border-rose-200 transition-colors"
              onClick={async () => {
                if (window.confirm("Are you sure you want to PERMANENTLY delete this account? This cannot be undone.")) {
                  try {
                    const token = localStorage.getItem("token");
                    await axios.delete(`${API}/admin/users/${u.user_id}`, {
                      headers: { Authorization: `Bearer ${token}` }
                    });
                    toast.success("User deleted");
                    window.location.reload(); // Refresh to update list
                  } catch (e) { toast.error("Delete failed"); }
                }
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

// App Router
function AppRouter() {
  const location = useLocation();

  // Check for session_id in URL hash (OAuth callback)
  if (location.hash?.includes('session_id=')) {
    return <AuthCallback />;
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/properties" element={<PropertiesPage />} />
      <Route path="/property/:id" element={<PropertyDetailPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route
        path="/tenant"
        element={
          <ProtectedRoute allowedTypes={["tenant"]}>
            <TenantDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenant/saved"
        element={
          <ProtectedRoute allowedTypes={["tenant"]}>
            <SavedPropertiesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tenant/messages"
        element={
          <ProtectedRoute allowedTypes={["tenant"]}>
            <MessagesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/landlord"
        element={
          <ProtectedRoute allowedTypes={["landlord"]}>
            <LandlordDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/landlord/subscription/success"
        element={
          <ProtectedRoute allowedTypes={["landlord"]}>
            <SubscriptionSuccessPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/landlord/messages"
        element={
          <ProtectedRoute allowedTypes={["landlord"]}>
            <MessagesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedTypes={["admin"]}>
            <AdminDashboard />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

// Main App
function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <SavedPropertiesProvider>
            <MessagingProvider>
              <Navbar />
              <AppRouter />
              <AIChatWidget />
              <Toaster position="top-right" richColors />
            </MessagingProvider>
          </SavedPropertiesProvider>
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
