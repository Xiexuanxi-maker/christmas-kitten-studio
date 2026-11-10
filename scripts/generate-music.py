"""Original studio cue: soft celesta-like winter waltz and delicate transition bells.
No sampled/commercial recording or external service is used. Produces a 40s stereo WAV.
"""
import math, random, wave, struct
from pathlib import Path
rate=22050; duration=40; out=[0.0]*(rate*duration)
def note(start, midi, length=1.4, gain=.11):
    f=440*2**((midi-69)/12)
    for i in range(min(int(length*rate),len(out)-int(start*rate))):
        t=i/rate; envelope=(1-math.exp(-t*130))*math.exp(-t*3.2)
        val=math.sin(2*math.pi*f*t)+.28*math.sin(2*math.pi*f*2.01*t)+.08*math.sin(2*math.pi*f*3.98*t)
        out[int(start*rate)+i]+=gain*envelope*val
# An original quiet rising/falling pentatonic winter motif, one note per beat.
melody=[76,79,83,81,79,76,74,76,79,76,71,74,76,79,81,79,76,74,71,74,76,74,71,69]
for n in range(64):
    st=.45+n*.59
    if st>37.5:break
    note(st,melody[n%len(melody)],2,.12 if n%3==0 else .085)
for bar in range(21):
    st=bar*1.77
    chord=[[48,55,64],[45,52,60],[53,60,69],[55,62,71]][bar%4]
    for j,p in enumerate(chord):note(st+j*.09,p,2.5,.046)
# Small, low-level bell accents align to shot cuts; the final chime resolves the film.
for st in [0,3,8,12,15,17,20,22.4,24.8,27.2,29.6,32,38.4]:
    for j,p in enumerate([88,95,100]): note(st+j*.035,p,.85,.025 if st<38 else .055)
Path('public/audio').mkdir(parents=True,exist_ok=True)
with wave.open('public/audio/christmas-bells.wav','wb') as wav:
    wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(rate)
    data=bytearray()
    for i,v in enumerate(out):
        t=i/rate; fade=min(1,t/.4,(duration-t)/1.7);v=math.tanh(v*1.3)*max(0,fade)
        data+=struct.pack('<hh',int(v*26000),int(v*25000))
    wav.writeframes(data)
print('Created original 40-second Christmas cue.')
