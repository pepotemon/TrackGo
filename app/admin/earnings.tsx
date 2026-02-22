import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import DateField from "../../src/components/DateField";
import type { EarningsSummary } from "../../src/data/repositories/earningsRepo";
import { subscribeEarningsByRange } from "../../src/data/repositories/earningsRepo"; // ✅ nuevo
import { listUsers } from "../../src/data/repositories/usersRepo";
import type { UserDoc } from "../../src/types/models";

function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function money(n: number) {
    // simple sin Intl por ahora (evita problemas de locale)
    const v = Number.isFinite(n) ? n : 0;
    return v.toFixed(2);
}

export default function AdminEarningsScreen() {
    const [users, setUsers] = useState<UserDoc[]>([]);
    const [summary, setSummary] = useState<EarningsSummary>({
        rows: [],
        totalVisited: 0,
        totalAmount: 0,
    });

    const [startKey, setStartKey] = useState(todayKey());
    const [endKey, setEndKey] = useState(todayKey());

    useEffect(() => {
        (async () => {
            const u = await listUsers("user");
            setUsers(u);
        })();
    }, []);

    useEffect(() => {
        if (!users.length) {
            setSummary({ rows: [], totalVisited: 0, totalAmount: 0 });
            return;
        }

        const unsub = subscribeEarningsByRange(startKey, endKey, users, setSummary);
        return () => unsub();
    }, [startKey, endKey, users]);

    const headerText = useMemo(() => {
        return `Rango: ${startKey} → ${endKey} · Visitados: ${summary.totalVisited} · Total: R$ ${money(
            summary.totalAmount
        )}`;
    }, [startKey, endKey, summary.totalVisited, summary.totalAmount]);

    return (
        <View style={{ padding: 16, gap: 12 }}>
            <Text style={{ fontWeight: "800", fontSize: 18, color: "#fff" }}>
                Comisiones
            </Text>

            <Text style={{ opacity: 0.85, color: "#fff" }}>{headerText}</Text>

            <DateField label="Inicio" value={startKey} onChange={setStartKey} />
            <DateField label="Fin" value={endKey} onChange={setEndKey} min={startKey} />

            <FlatList
                data={summary.rows}
                keyExtractor={(r) => r.userId}
                renderItem={({ item }) => (
                    <View
                        style={{
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderBottomColor: "rgba(255,255,255,0.10)",
                            gap: 4,
                        }}
                    >
                        <Text style={{ fontWeight: "700", color: "#fff" }}>
                            {item.name} {item.email ? `— ${item.email}` : ""}
                        </Text>

                        <Text style={{ opacity: 0.9, color: "#fff" }}>
                            Tarifa: R$ {money(item.ratePerVisit)} · Visitados: {item.visited}
                        </Text>

                        <Text style={{ fontWeight: "800", color: "#fff" }}>
                            Total: R$ {money(item.amount)}
                        </Text>
                    </View>
                )}
                ListEmptyComponent={
                    <Text style={{ opacity: 0.7, paddingVertical: 20, color: "#fff" }}>
                        No hay datos en este rango.
                    </Text>
                }
            />
        </View>
    );
}