import { Composition } from 'remotion';
import { DestinationReel, destinationReelSchema } from './compositions/DestinationReel';
import { AppShowcaseReel } from './compositions/AppShowcaseReel';
import { FORMATS } from './theme';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="DestinationReel"
        component={DestinationReel}
        durationInFrames={450}
        fps={FORMATS.reel.fps}
        width={FORMATS.reel.width}
        height={FORMATS.reel.height}
        schema={destinationReelSchema}
        defaultProps={{
          destination: 'tokyo',
          locale: 'en' as const,
        }}
      />
      <Composition
        id="AppShowcaseReel"
        component={AppShowcaseReel}
        durationInFrames={450}
        fps={FORMATS.reel.fps}
        width={FORMATS.reel.width}
        height={FORMATS.reel.height}
        defaultProps={{}}
      />
    </>
  );
};
