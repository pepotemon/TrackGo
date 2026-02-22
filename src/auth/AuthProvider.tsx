import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    type User,
} from "firebase/auth";
import React, {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { auth } from "../config/firebase";
import { getUserDoc } from "../data/repositories/usersRepo";
import type { UserDoc } from "../types/models";

type AuthState = {
    firebaseUser: User | null;
    profile: UserDoc | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<UserDoc | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Arrancamos en loading hasta saber el estado de auth
        setLoading(true);

        const unsub = onAuthStateChanged(auth, async (u) => {
            setFirebaseUser(u);
            setProfile(null);

            if (!u) {
                // No hay sesión
                setLoading(false);
                return;
            }

            try {
                console.log("[AUTH] uid:", u.uid, "email:", u.email);

                const doc = await getUserDoc(u.uid);

                console.log("[AUTH] profile doc:", doc);

                setProfile(doc); // puede ser null si no existe
            } catch (err) {
                console.log("[AUTH] error loading profile:", err);
                setProfile(null);
            } finally {
                setLoading(false);
            }
        });

        return () => unsub();
    }, []);

    const login = async (email: string, password: string) => {
        // Opcional: podrías setLoading(true) aquí, pero onAuthStateChanged se encarga
        await signInWithEmailAndPassword(auth, email.trim(), password);
    };

    const logout = async () => {
        await signOut(auth);
    };

    const value = useMemo(
        () => ({ firebaseUser, profile, loading, login, logout }),
        [firebaseUser, profile, loading]
    );

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
    const v = useContext(Ctx);
    if (!v) throw new Error("useAuth must be used within AuthProvider");
    return v;
}
