import React, { useState, useRef, useEffect, useCallback } from "react";
import { styled, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import PauseRounded from "@mui/icons-material/PauseRounded";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import FastForwardRounded from "@mui/icons-material/FastForwardRounded";
import FastRewindRounded from "@mui/icons-material/FastRewindRounded";
import VolumeUpRounded from "@mui/icons-material/VolumeUpRounded";
import VolumeDownRounded from "@mui/icons-material/VolumeDownRounded";

const Widget = styled("div")(({ theme }) => ({
  padding: 16,
  borderRadius: 16,
  width: 343,
  maxWidth: "100%",
  margin: "auto",
  position: "relative",
  zIndex: 1,
  backgroundColor:
    theme.palette.mode === "dark" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.4)",
  backdropFilter: "blur(40px)",
}));

const TinyText = styled(Typography)({
  fontSize: "0.75rem",
  opacity: 0.38,
  fontWeight: 500,
  letterSpacing: 0.2,
});

const AudioPlayer = React.forwardRef(function AudioPlayer({ sessionId, audioUrl }, ref) {
  const theme = useTheme();
  const audioRef = useRef(new Audio());
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [paused, setPaused] = useState(true);

  const fetchAudio = useCallback(() => {
    console.log(sessionId)
    console.log(audioUrl)
    if (sessionId && audioUrl) {
      const audioSrc = `http://localhost:5500/audio/session/session_${sessionId}.wav`;
      console.log('Audio URL:', audioSrc); // Log the URL for debugging
      const audioElement = audioRef.current;
      audioElement.src = audioSrc;

      audioElement.addEventListener('loadedmetadata', () => {
        setDuration(audioElement.duration);
        setPaused(true); // Ensure to start in paused state
      });

      audioElement.addEventListener('timeupdate', () => {
        setPosition(audioElement.currentTime);
      });

      audioElement.onerror = (error) => {
        console.error("Error loading audio file:", error);
      };

      return () => {
        audioElement.removeEventListener('loadedmetadata', () => {});
        audioElement.removeEventListener('timeupdate', () => {});
      };
    }
  }, [sessionId, audioUrl]);

  useEffect(() => {
    const audioElement = audioRef.current;
    fetchAudio();

    return () => {
      audioElement.removeEventListener('loadedmetadata', () => {});
      audioElement.removeEventListener('timeupdate', () => {});
    };
  }, [fetchAudio]);

  const formatDuration = useCallback((value) => {
    const minute = Math.floor(value / 60);
    const secondLeft = value - minute * 60;
    return `${minute}:${secondLeft < 10 ? `0${secondLeft}` : secondLeft}`;
  }, []);

  const mainIconColor = theme.palette.mode === "dark" ? "#fff" : "#000";
  const lightIconColor = theme.palette.mode === "dark" ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";

  const handlePlayPause = () => {
    const audioElement = audioRef.current;
    if (paused) {
      audioElement.play().catch((error) => {
        console.error("Error playing audio:", error);
      });
    } else {
      audioElement.pause();
    }
    setPaused(!paused);
  };

  const handleSliderChange = (_, value) => {
    setPosition(value);
    audioRef.current.currentTime = value;
  };

  const handleVolumeChange = (_, value) => {
    audioRef.current.volume = value / 100;
  };

  return (
    <Box sx={{ width: "100%", overflow: "hidden" }} ref={ref}>
      <Widget>
        <Slider
          aria-label="time-indicator"
          size="small"
          value={position}
          min={0}
          step={1}
          max={duration}
          onChange={handleSliderChange}
          sx={{
            color: theme.palette.mode === "dark" ? "#fff" : "rgba(0,0,0,0.87)",
            height: 4,
            "& .MuiSlider-thumb": {
              width: 8,
              height: 8,
              transition: "0.3s cubic-bezier(.47,1.64,.41,.8)",
              "&::before": {
                boxShadow: "0 2px 12px 0 rgba(0,0,0,0.4)",
              },
              "&:hover, &.Mui-focusVisible": {
                boxShadow: `0px 0px 0px 8px ${
                  theme.palette.mode === "dark"
                    ? "rgb(255 255 255 / 16%)"
                    : "rgb(0 0 0 / 16%)"
                }`,
              },
              "&.Mui-active": {
                width: 20,
                height: 20,
              },
            },
            "& .MuiSlider-rail": {
              opacity: 0.28,
            },
          }}
        />
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: -2 }}>
          <TinyText>{formatDuration(position)}</TinyText>
          <TinyText>-{formatDuration(duration - position)}</TinyText>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", mt: -1 }}>
          <IconButton aria-label="previous song">
            <FastRewindRounded fontSize="large" htmlColor={mainIconColor} />
          </IconButton>
          <IconButton aria-label={paused ? "play" : "pause"} onClick={handlePlayPause}>
            {paused ? (
              <PlayArrowRounded sx={{ fontSize: "3rem" }} htmlColor={mainIconColor} />
            ) : (
              <PauseRounded sx={{ fontSize: "3rem" }} htmlColor={mainIconColor} />
            )}
          </IconButton>
          <IconButton aria-label="next song">
            <FastForwardRounded fontSize="large" htmlColor={mainIconColor} />
          </IconButton>
        </Box>
        <Stack spacing={2} direction="row" sx={{ mb: 1, px: 1 }} alignItems="center">
          <VolumeDownRounded htmlColor={lightIconColor} />
          <Slider
            aria-label="Volume"
            defaultValue={50}
            onChange={handleVolumeChange}
            sx={{
              color: theme.palette.mode === "dark" ? "#fff" : "rgba(0,0,0,0.87)",
              "& .MuiSlider-track": {
                border: "none",
              },
              "& .MuiSlider-thumb": {
                width: 24,
                height: 24,
                backgroundColor: "#fff",
                "&::before": {
                  boxShadow: "0 4px 8px rgba(0,0,0,0.4)",
                },
                "&:hover, &.Mui-focusVisible, &.Mui-active": {
                  boxShadow: "none",
                },
              },
            }}
          />
          <VolumeUpRounded htmlColor={lightIconColor} />
        </Stack>
      </Widget>
    </Box>
  );
});

export default AudioPlayer;