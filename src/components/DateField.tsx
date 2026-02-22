import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

function toDayKey(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseDayKey(dayKey: string) {
    const [y, m, d] = dayKey.split("-").map((x) => parseInt(x, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

export default function DateField(props: {
    label: string;
    value: string; // YYYY-MM-DD
    onChange: (dayKey: string) => void;
    min?: string;
    max?: string;
}) {
    const { label, value, onChange, min, max } = props;
    const [open, setOpen] = useState(false);

    const dateValue = useMemo(() => parseDayKey(value), [value]);
    const minDate = useMemo(() => (min ? parseDayKey(min) : undefined), [min]);
    const maxDate = useMemo(() => (max ? parseDayKey(max) : undefined), [max]);

    const onPick = (e: DateTimePickerEvent, selected?: Date) => {
        if (Platform.OS !== "ios") setOpen(false);
        if (e.type === "dismissed") return;
        const d = selected ?? dateValue;
        onChange(toDayKey(d));
    };

    return (
        <View style={{ gap: 6 }}>
            <Text style={{ fontWeight: "600" }}>{label}</Text>

            <Pressable
                onPress={() => setOpen(true)}
                style={{ borderWidth: 1, padding: 12, borderRadius: 8 }}
            >
                <Text>{value}</Text>
            </Pressable>

            {open && (
                <DateTimePicker
                    value={dateValue}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    onChange={onPick}
                    minimumDate={minDate}
                    maximumDate={maxDate}
                />
            )}

            {Platform.OS === "ios" && open ? (
                <Pressable
                    onPress={() => setOpen(false)}
                    style={{ padding: 10, alignSelf: "flex-start" }}
                >
                    <Text style={{ fontWeight: "600" }}>OK</Text>
                </Pressable>
            ) : null}
        </View>
    );
}
