import sys

f = sys.stdin.read().replace("null", "None")
f = eval(f)

byteam = {}

def recordmatch(team, replay, win, side, opp):
    if team not in byteam:
        byteam[team] = [[], []]

    byteam[team][win].append([side, replay, opp])

for i in f:
    m = i["matches"]
    t = i["team_list"]
    if i["type"] == "normal":
        t = t[0] + t[1]
    for j in range(len(m)):

        if t[j*2] == None or t[j*2+1] == None: continue

        recordmatch(t[j*2][1], m[j][0][1], m[j][0][0] == "redwon", "red", t[j*2+1][1])
        recordmatch(t[j*2+1][1], m[j][0][1], m[j][0][0] != "redwon", "blue", t[j*2][1])

        recordmatch(t[j*2][1], m[j][1][1], m[j][1][0] == "bluewon", "blue", t[j*2+1][1])
        recordmatch(t[j*2+1][1], m[j][1][1], m[j][1][0] != "bluewon", "red", t[j*2][1])

        recordmatch(t[j*2][1], m[j][2][1], m[j][2][0] == "redwon", "red", t[j*2+1][1])
        recordmatch(t[j*2+1][1], m[j][2][1], m[j][2][0] != "redwon", "blue", t[j*2][1])

for i in sorted(byteam, key=lambda a: len(byteam[a][0]) + len(byteam[a][1])):
    print i + ":"
    print "Wins:"
    for j in byteam[i][1]:
        print j[1], j[0], j[2]
    print "Losses:"
    for j in byteam[i][0]:
        print j[1], j[0], j[2]
    print
