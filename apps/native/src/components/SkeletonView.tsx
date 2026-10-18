import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

export interface SkeletonViewProps {
  height?: number;
  width?: number | string;
  borderRadius?: number;
  count?: number;
  style?: ViewStyle;
}

export const SkeletonView: React.FC<SkeletonViewProps> = ({
  height = 20,
  width = '100%',
  borderRadius = 8,
  count = 1,
  style,
}) => {
  return (
    <View style={styles.container}>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.skeleton,
            { height, width: width as unknown as number, borderRadius },
            style,
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 8,
  },
  skeleton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});
