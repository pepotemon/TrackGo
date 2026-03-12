import React from "react";
import { ImageBackground, StyleSheet, View } from "react-native";
import bgMap from "../../../assets/bg-map.png";

type Props = {
    children: React.ReactNode;
};

export default function AdminBackground({ children }: Props) {
    return (
        <ImageBackground
            source={bgMap}
            style={styles.bg}
            imageStyle={styles.bgImage}
            resizeMode="cover"
        >
            <View style={styles.overlay}>{children}</View>
        </ImageBackground>
    );
}

const styles = StyleSheet.create({
    bg: {
        flex: 1,
    },
    bgImage: {
        opacity: 0.55,
    },
    overlay: {
        flex: 1,
        backgroundColor: "rgba(11,18,32,0.40)",
    },
});